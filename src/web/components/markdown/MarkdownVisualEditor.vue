<script setup lang="ts">
import { onActivated, onDeactivated, useTemplateRef, watch } from 'vue'
import type { EditorView } from '@milkdown/kit/prose/view'
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import { useNoteVisualEditor } from '@/composables/notes/use-note-visual-editor'
import { useEditorVisualLinks } from '@/composables/use-editor-visual-links'
import type { EditorLinkSource } from '@/utils/editor-links'
import EditorLinkSuggestions from './EditorLinkSuggestions.vue'

// The editor reads `text` once at mount; the parent remounts it to load other text.
const props = defineProps<{ text: string; source: EditorLinkSource }>()
const emit = defineEmits<{
  change: [text: string]
  unsupported: []
  ready: []
  link: []
}>()
const root = useTemplateRef<HTMLDivElement>('root')
let currentView: () => EditorView | undefined = () => undefined
const links = useEditorVisualLinks(() => currentView(), props.source)
const { popup, active, prepareLink, insertTarget } = links
const visible = usePaneVisibility()
watch(visible, value => {
  if (!value) popup.value = null
})
onDeactivated(() => {
  popup.value = null
})
onActivated(() => emit('ready'))
const { error, getView } = useNoteVisualEditor(root, () => props.text, {
  change: text => emit('change', text),
  unsupported: () => emit('unsupported'),
  ready: () => emit('ready'),
  link: () => {
    prepareLink()
    emit('link')
  },
  update: links.updatePopup,
  keydown: links.handleKeyDown
})
currentView = getView
defineExpose({ prepareLink, insertTarget })
</script>
<template>
  <div class="note-visual">
    <q-banner v-if="error" dense class="text-negative">{{ error }}</q-banner>
    <Teleport to="body">
      <EditorLinkSuggestions
        v-if="popup"
        class="agent-menu markdown-mention-list"
        :style="{ left: popup.left + 'px', top: popup.top + 'px' }"
        :targets="source.matches.value"
        :active="active"
        @select="insertTarget($event, true)"
      />
    </Teleport>
    <div ref="root" />
  </div>
</template>
<style src="../../css/note-visual-editor.css"></style>
<style scoped>
.markdown-mention-list {
  position: fixed;
  z-index: 7000;
  width: 320px;
  max-width: calc(100vw - 16px);
  box-shadow: 0 4px 16px #0003;
}
</style>
