<script setup lang="ts">
import { PREVIEW_WINDOW_ID } from '@/constants/windows/constants'
import { shallowRef } from 'vue'
import { PREVIEW_FILE_ACCEPT } from '@/utils/windows/local-preview'
import { errorMessage } from '@/utils/error-message'
import { useI18n } from 'vue-i18n'
import { useFilePicker, useQuasar } from 'quasar'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useWindowStore } from '@/stores/windows/window-store'
import { useWindowGeometry } from '@/composables/windows/use-window-geometry'
import FloatingWindow from '@/components/windows/FloatingWindow.vue'
import PreviewContent from './PreviewContent.vue'
import PreviewWindowHeader from './PreviewWindowHeader.vue'
import PreviewTabs from './PreviewTabs.vue'
import PreviewEmptyState from './PreviewEmptyState.vue'

const { t } = useI18n()
const $q = useQuasar()
const preview = usePreviewStore()
const windows = useWindowStore()
const { state, drag } = useWindowGeometry(PREVIEW_WINDOW_ID)
const { openFilePicker, resetFilePicker } = useFilePicker({
  multiple: true,
  accept: PREVIEW_FILE_ACCEPT,
  onChange: files => {
    void openFiles(files)
    resetFilePicker()
  },
  onRejected: entries => {
    for (const { file } of entries) notifyUnsupported(file)
    resetFilePicker()
  }
})
const dragging = shallowRef(false)
let dragDepth = 0
async function openFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    try {
      if (!preview.openLocal(file)) notifyUnsupported(file)
    } catch (failure) {
      $q.notify({ type: 'negative', message: errorMessage(failure) })
    }
  }
}
function notifyUnsupported(file: File) {
  $q.notify({
    type: 'warning',
    message: t('windows.unsupportedFile', { name: file.name })
  })
}
function dragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth++
  dragging.value = true
}
function dragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}
function dragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}
function dropFiles(event: DragEvent) {
  event.preventDefault()
  dragging.value = false
  dragDepth = 0
  if (event.dataTransfer?.files.length) void openFiles(event.dataTransfer.files)
}
function requestClose(id: string | null) {
  $q.dialog({
    title: t(id === null ? 'windows.closeAllTitle' : 'windows.closeTitle'),
    message: t(
      id === null ? 'windows.closeAllMessage' : 'windows.closeMessage'
    ),
    cancel: { label: t('windows.cancel'), flat: true },
    ok: {
      label: t(id === null ? 'windows.closeAll' : 'windows.closeTab'),
      color: 'negative',
      flat: true
    }
  }).onOk(() => {
    if (id === null) {
      preview.closeAll()
    } else {
      preview.close(id)
    }
  })
}
function minimize() {
  state.minimized = true
  windows.remember()
}
function maximize() {
  state.maximized = !state.maximized
  windows.remember()
}
</script>

<template>
  <FloatingWindow
    :window-id="PREVIEW_WINDOW_ID"
    :title="t('windows.preview')"
    @dragenter="dragEnter"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop="dropFiles"
  >
    <template #header>
      <PreviewWindowHeader
        :maximized="state.maximized"
        @drag="drag"
        @open-file="openFilePicker"
        @minimize="minimize"
        @toggle-maximized="maximize"
        @close-all="requestClose(null)"
      />
      <PreviewTabs
        :tabs="preview.tabs"
        :active-id="preview.activeId"
        @activate="preview.activate"
        @open-file="openFilePicker"
        @request-close="requestClose"
      />
    </template>
    <div
      v-if="dragging"
      class="preview-drop-overlay column items-center justify-center"
    >
      <q-icon name="upload_file" size="48px" />
      <div class="q-mt-sm">{{ t('windows.dropFiles') }}</div>
    </div>
    <PreviewContent
      v-if="preview.activeTab"
      :key="preview.activeTab.id"
      :tab="preview.activeTab"
      :visible="state.open && !state.minimized"
    />
    <PreviewEmptyState v-else @open-file="openFilePicker" />
  </FloatingWindow>
</template>

<style scoped>
.preview-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border: 2px dashed var(--q-primary);
  border-radius: 8px;
  background: var(--window-header-bg);
  color: var(--q-primary);
}
</style>
