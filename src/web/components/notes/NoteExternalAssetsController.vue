<script setup lang="ts">
import { nextTick } from 'vue'
import { useEventListener, useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useNoteExternalAssets } from '@/composables/notes/use-note-external-assets'
import type { NoteDraft } from '@/stores/notes-store'
import {
  isNoteAssetShortcut,
  type ExternalAssetEdit
} from '../../../shared/notes/external-assets.ts'
import NoteExternalAssetsDialog from './NoteExternalAssetsDialog.vue'
import { usePaneVisibility } from '@/composables/use-pane-visibility'

const props = defineProps<{ draft: NoteDraft; pane: HTMLElement | null }>()
const emit = defineEmits<{
  apply: [text: string, edits: ExternalAssetEdit[]]
}>()
const $q = useQuasar()
const { t } = useI18n()
const visible = usePaneVisibility()
let returnFocus: HTMLElement | null = null
const assets = useNoteExternalAssets(() => props.draft, {
  protocol: typeof location === 'undefined' ? 'https:' : location.protocol,
  empty: () =>
    $q.notify({
      message: t('notes.externalAssets.empty'),
      position: 'top-right'
    }),
  apply: (text, edits) => emit('apply', text, edits)
})
const { opened, busy, rows, replacements, canRestore } = assets
function open() {
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  assets.open()
}
function shortcut(event: KeyboardEvent) {
  if (!isNoteAssetShortcut(event) || opened.value) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  open()
}
useEventListener(
  () => window,
  'keydown',
  shortcut,
  () => ({ capture: true, disabled: !visible() })
)
function close() {
  assets.close()
  void nextTick(() => {
    if (!visible()) return
    if (returnFocus?.isConnected) {
      returnFocus.focus()
    } else {
      props.pane
        ?.querySelector<HTMLElement>('.ProseMirror, textarea.note-source')
        ?.focus()
    }
  })
}
defineExpose({ open })
</script>
<template>
  <NoteExternalAssetsDialog
    :open="opened"
    :rows="rows"
    :busy="busy"
    :replacements="replacements"
    :can-restore="canRestore"
    @close="close"
    @download="assets.download"
    @restore="assets.restore"
    @select-all="assets.selectAll"
    @inspect="assets.inspect"
    @select="(row, value) => (row.selected = value)"
    @confirm="assets.confirm"
  />
</template>
