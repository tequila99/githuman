<script setup lang="ts">
import { useAppTheme } from '@/composables/use-app-theme'
import { formatDateTime } from '@/utils/date'
import { mdiHistory } from '@mdi/js'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Artifact } from '@/api/types'
import { createArtifactHistoryPage } from '@/utils/artifact-details'
import { useArtifactDetailPage } from '@/composables/artifacts/use-artifact-detail-page'
import ArtifactDetailState from './ArtifactDetailState.vue'

const props = defineProps<{ artifact: Artifact }>()
const open = shallowRef(false)
const { t } = useI18n()
const { isDark } = useAppTheme()
const resource = useArtifactDetailPage(
  createArtifactHistoryPage(props.artifact),
  open
)
const events = computed(
  () =>
    resource.state.page?.items.map(event => ({
      ...event,
      payload: JSON.stringify(event.metadata, null, 2)
    })) ?? []
)
</script>
<template>
  <q-expansion-item
    v-model="open"
    :icon="mdiHistory"
    :label="t('artifacts.details.history')"
    class="app-icon-expansion artifact-history artifact-summary q-mb-md"
    :class="{ 'artifact-summary--dark': isDark }"
  >
    <div v-if="open" class="q-pa-md">
      <ArtifactDetailState
        :loading="resource.state.loading"
        :error="resource.state.error"
        :stale="resource.state.stale"
      />
      <ol class="artifact-history__events">
        <li v-for="event in events" :key="event.seq" class="q-mb-md">
          <div class="artifact-summary__title">{{ event.metadata.title }}</div>
          <div class="artifact-summary__caption q-mt-xs">
            {{ formatDateTime(event.createdAt) }} · {{ event.actor.kind }}:
            {{ event.actor.id }} · #{{ event.seq }} ·
            {{
              t('artifacts.details.eventVersion', {
                version: event.afterVersion
              })
            }}
            ·
            {{ t('artifacts.details.actions.' + event.action) }}
          </div>
          <q-expansion-item
            class="app-icon-expansion"
            :label="t('artifacts.details.recordedMetadata')"
            dense
          >
            <pre class="artifact-history__payload">{{ event.payload }}</pre>
          </q-expansion-item>
        </li>
      </ol>
      <div
        v-if="
          !resource.state.loading && !resource.state.error && !events.length
        "
        class="q-pa-sm text-grey"
        >{{ t('artifacts.details.noHistory') }}</div
      >
      <q-btn
        v-if="resource.state.page?.nextAfterSeq !== null && resource.state.page"
        flat
        :disable="resource.state.loading || resource.state.stale"
        :label="t('artifacts.more')"
        @click="resource.more"
      />
    </div>
  </q-expansion-item>
</template>
<style scoped>
.artifact-history {
  font-size: 14px;
  line-height: 20px;
}
.artifact-history__events {
  padding-left: 24px;
  overflow-wrap: anywhere;
}
.artifact-history__payload {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
}
</style>
