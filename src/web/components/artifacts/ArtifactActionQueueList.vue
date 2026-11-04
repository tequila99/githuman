<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import TextButton from '@/components/buttons/TextButton.vue'
import { useAppTheme } from '@/composables/use-app-theme'
import { useArtifactCommandLabel } from '@/composables/artifacts/use-artifact-command-label'
import { useArtifactSessionLabel } from '@/composables/artifacts/use-artifact-session-label'
import { formatTime } from '@/utils/date'
import type { ArtifactActionListItem } from '@/api/types'

// Match the row height of the artifact catalog before Quasar measures it.
const ROW_HEIGHT_ESTIMATE = 60

defineProps<{
  items: ArtifactActionListItem[]
  selectedId: string | null
  disabled: boolean
  listError: string | null
}>()
const emit = defineEmits<{
  (e: 'pick', id: string): void
  (e: 'refresh'): void
}>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const sessionLabel = useArtifactSessionLabel()
const commandLabel = useArtifactCommandLabel()
</script>

<template>
  <div
    class="artifact-queue column no-wrap artifact-summary"
    :class="{ 'artifact-summary--dark': isDark }"
  >
    <div v-if="listError" class="text-negative q-pa-sm" role="alert">
      {{ listError }}
      <TextButton
        :label="t('artifacts.actions.refreshScope')"
        @click="emit('refresh')"
      />
    </div>
    <q-virtual-scroll
      v-if="items.length"
      :items="items"
      :virtual-scroll-item-size="ROW_HEIGHT_ESTIMATE"
      class="col artifact-queue__scroll"
      role="list"
    >
      <template #default="{ item }">
        <q-item
          :key="item.id"
          role="listitem"
          clickable
          :dark="isDark"
          class="artifact-queue__item"
          :active="item.id === selectedId"
          :aria-current="item.id === selectedId ? 'true' : undefined"
          :disable="disabled"
          @click="emit('pick', item.id)"
        >
          <q-item-section class="artifact-queue__main">
            <q-item-label
              class="artifact-summary__title ellipsis"
              :title="item.summary?.reason"
              >{{
                item.summary?.reason || sessionLabel(item.sessionId)
              }}</q-item-label
            >
            <q-item-label caption class="artifact-summary__caption ellipsis">
              {{ sessionLabel(item.sessionId) }} ·
              <template v-if="item.summary">
                {{ commandLabel(item.summary.command) }} ·
                {{
                  t(
                    'artifacts.actions.queueDocuments',
                    item.summary.documentCount
                  )
                }}
                ·
              </template>
              {{
                t('artifacts.actions.queueUntil', {
                  time: formatTime(item.expiresAt)
                })
              }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </template>
    </q-virtual-scroll>
    <div v-else class="q-pa-md text-grey">
      {{ t('artifacts.actions.empty') }}
      {{ t('artifacts.actions.emptyHint') }}
    </div>
  </div>
</template>

<style scoped>
.artifact-queue {
  min-height: 0;
}
.artifact-queue__scroll {
  min-height: 0;
}
/* The row follows ArtifactCatalogItem: same height, divider and active mark. */
.artifact-queue__item {
  min-width: 0;
  min-height: 60px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
.artifact-queue__item.q-item--active {
  color: inherit;
  box-shadow: inset 3px 0 var(--q-primary);
  background-image: linear-gradient(
    rgba(25, 118, 210, 0.1),
    rgba(25, 118, 210, 0.1)
  );
}
.artifact-queue__item:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.artifact-queue__main {
  min-width: 0;
}
</style>
