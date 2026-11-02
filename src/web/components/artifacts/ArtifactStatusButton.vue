<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiMenuDown } from '@mdi/js'
import { useArtifactTransition } from '@/composables/artifacts/use-artifact-transition'
import ArtifactStatusBadge from './ArtifactStatusBadge.vue'
import ArtifactTransitionDialog from './ArtifactTransitionDialog.vue'
import ArtifactTransitionProgress from './ArtifactTransitionProgress.vue'
import type { Artifact } from '@/api/types'

const props = withDefaults(
  defineProps<{
    artifact: Artifact
    /** False while the document body is not verified; a new start is refused. */
    contentReady?: boolean
  }>(),
  { contentReady: true }
)
const { t } = useI18n()
const { entry, store } = useArtifactTransition(() => props.artifact.id)
const dialog = ref(false)
const target = ref<Artifact['status'] | null>(null)

const operation = computed(() => entry.value.operation)
// Boolean() covers both null and the undefined of options that are not loaded yet.
const running = computed(() => Boolean(entry.value.options?.activeOperationId))
const loading = computed(() => !entry.value.loaded)
const failed = computed(() => entry.value.error !== null)
// Targets are shown only while the loaded menu data matches the document status.
const targets = computed(() =>
  entry.value.options?.status === props.artifact.status && !entry.value.stale
    ? entry.value.options.targets
    : []
)

function choose(status: Artifact['status']) {
  // Retry of a finished operation comes here too, so the gate lives here.
  if (!props.contentReady) {
    return
  }
  target.value = status
  dialog.value = true
}
</script>

<template>
  <div class="artifact-status-button row items-center no-wrap q-gutter-x-sm">
    <q-btn
      v-if="targets.length && !running && contentReady"
      dense
      flat
      no-caps
      class="artifact-status-button__trigger"
      :aria-label="
        t('artifacts.transition.button', {
          status: t('artifacts.statuses.' + artifact.status)
        })
      "
    >
      <ArtifactStatusBadge :status="artifact.status" />
      <q-icon :name="mdiMenuDown" size="1.2em" class="app-icon-control" />
      <q-menu auto-close>
        <q-list dense style="min-width: 12rem">
          <q-item-label header>{{
            t('artifacts.transition.menuTitle')
          }}</q-item-label>
          <q-item
            v-for="item in targets"
            :key="item.status"
            clickable
            :disable="!item.available"
            @click="choose(item.status)"
          >
            <q-item-section>
              <q-item-label>{{
                t('artifacts.statuses.' + item.status)
              }}</q-item-label>
              <q-item-label v-if="item.reason" caption>{{
                item.reason
              }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-btn>
    <ArtifactStatusBadge v-else :status="artifact.status" />
    <q-spinner
      v-if="loading"
      size="1em"
      :aria-label="t('artifacts.transition.loadingMenu')"
    />
    <span
      v-if="failed"
      class="row items-center no-wrap q-gutter-x-xs"
      role="alert"
    >
      <span class="text-caption text-negative">{{
        t('artifacts.transition.loadFailed')
      }}</span>
      <q-btn
        dense
        flat
        no-caps
        size="sm"
        :label="t('artifacts.transition.reload')"
        @click="store.load(artifact.id)"
      />
    </span>
    <ArtifactTransitionProgress
      v-if="operation"
      :operation="operation"
      @retry="choose(operation.targetStatus)"
    />
    <ArtifactTransitionDialog
      v-model="dialog"
      :artifact-id="artifact.id"
      :target="target"
      :content-ready="contentReady"
    />
  </div>
</template>
