<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { useProjectFilesStore } from '@/stores/project-files-store'
import { errorMessage } from '@/utils/error-message'
import { projectFileFromQuery } from '@/utils/windows/project-file-link'
import AppPage from '@/components/AppPage.vue'

const { t } = useI18n()
const route = useRoute()
const files = useProjectFilesStore()
const workspace = useWorkspaceNavigation()
const error = shallowRef('')
const downloaded = shallowRef(false)
// Only the file parameters restart the open. The query also holds UI state
// such as uiPane, and a pane change must not open or download the file again.
watch(
  [
    () => route.query.path,
    () => route.query.ref,
    () => route.query.line,
    () => route.query.column,
    () => route.query.anchor
  ],
  async (_current, _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    downloaded.value = false
    error.value = ''
    try {
      const request = projectFileFromQuery(key => {
        const value = route.query[key]
        return typeof value === 'string' ? value : null
      })
      if (!request) throw new Error(t('windows.fileLinkFailed'))
      const opened = await files.open(
        request.link,
        request.ref,
        controller.signal
      )
      if (opened) {
        await workspace.openWindow('preview')
      } else {
        downloaded.value = true
      }
    } catch (failure) {
      if (!controller.signal.aborted) error.value = errorMessage(failure)
    }
  },
  { immediate: true }
)
</script>
<template>
  <AppPage
    ><div v-if="error" class="q-pa-md text-negative" role="alert">{{
      error
    }}</div
    ><div v-else-if="downloaded" class="q-pa-md" role="status">{{
      t('windows.fileDownloading')
    }}</div></AppPage
  >
</template>
