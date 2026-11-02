<script setup lang="ts">
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import { registerArtifactRefresh } from '@/composables/artifacts/artifact-refresh'
import { formatDateTime } from '@/utils/date'
import { mdiInformationOutline } from '@mdi/js'
import { shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import type { Artifact } from '@/api/types'

const props = defineProps<{ artifact: Artifact }>()
const definitions = useArtifactDefinitionsStore().forStore(
  props.artifact.storeId
)
const open = shallowRef(false)
const visible = usePaneVisibility()
const route = useRoute()
const { t } = useI18n()
registerArtifactRefresh(async () => {
  if (open.value && visible()) await definitions.invalidate()
})
watch(
  () => [
    open.value && visible(),
    props.artifact.typeId,
    ...props.artifact.taskIds
  ],
  async (_value, _previous, onCleanup) => {
    if (!open.value || !visible()) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    const { typeId, taskIds } = props.artifact
    await definitions.resolve('type', typeId).catch(() => {})
    for (let index = 0; index < taskIds.length; index += 4) {
      if (cancelled) return
      await Promise.allSettled(
        taskIds
          .slice(index, index + 4)
          .map(id => definitions.resolve('task', id))
      )
    }
  }
)
function taskRoute(id: string) {
  return {
    path: '/artifacts',
    query: { ...route.query, taskId: id, uiPane: 'list', uiWindow: undefined }
  }
}
</script>
<template>
  <q-expansion-item
    v-model="open"
    :icon="mdiInformationOutline"
    :label="t('artifacts.details.metadata')"
    class="app-icon-expansion q-mb-md"
    bordered
  >
    <div v-if="open" class="q-pa-md artifact-metadata">
      <dl class="artifact-metadata__fields">
        <dt>{{ t('artifacts.details.currentTitle') }}</dt
        ><dd>{{ artifact.title }}</dd> <dt>{{ t('artifacts.status') }}</dt
        ><dd>{{ t('artifacts.statuses.' + artifact.status) }}</dd>
        <dt>{{ t('artifacts.type') }}</dt
        ><dd>{{
          definitions.typeLabels.get(artifact.typeId)?.label ?? artifact.typeId
        }}</dd>
        <dt>{{ t('artifacts.details.tasks') }}</dt>
        <dd
          ><template v-if="artifact.taskIds.length"
            ><router-link
              v-for="id in artifact.taskIds"
              :key="id"
              :to="taskRoute(id)"
              class="artifact-metadata__task"
              >{{ definitions.taskLabels.get(id)?.title ?? id }}</router-link
            ></template
          ><span v-else>{{ t('artifacts.details.none') }}</span></dd
        >
        <dt>{{ t('artifacts.tag') }}</dt
        ><dd>{{ artifact.tags.join(', ') || t('artifacts.details.none') }}</dd>
        <dt>{{ t('artifacts.details.version') }}</dt
        ><dd>{{ artifact.metadataVersion }}</dd>
        <dt>{{ t('artifacts.details.created') }}</dt
        ><dd>{{ formatDateTime(artifact.createdAt) }}</dd>
        <dt>{{ t('artifacts.details.updated') }}</dt
        ><dd>{{ formatDateTime(artifact.metadataUpdatedAt) }}</dd>
        <dt>{{ t('artifacts.identity') }}</dt
        ><dd>{{ artifact.id }}</dd> <dt>{{ t('artifacts.store') }}</dt
        ><dd>{{ artifact.storeId }}</dd> <dt>SHA-256</dt
        ><dd>{{ artifact.sha256 }}</dd>
        <dt>{{ t('artifacts.details.bytes') }}</dt
        ><dd>{{ artifact.bytes }}</dd>
        <template v-if="artifact.sourcePath">
          <dt>{{ t('artifacts.details.sourcePath') }}</dt
          ><dd class="artifact-metadata__source">{{ artifact.sourcePath }}</dd>
        </template>
      </dl>
    </div>
  </q-expansion-item>
</template>
<style scoped>
.artifact-metadata {
  overflow-wrap: anywhere;
}
.artifact-metadata__fields {
  margin: 0;
}
.artifact-metadata__fields dt {
  opacity: 0.7;
  font-size: 12px;
}
.artifact-metadata__fields dd {
  margin: 0 0 12px;
  white-space: pre-wrap;
}
.artifact-metadata__task {
  display: block;
}
</style>
