<script setup lang="ts">
import { hasNoteFrontmatter } from '@/utils/notes/document-paste'
import { useTemplateRef, watch, onActivated, onDeactivated } from 'vue'
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useNoteVisualEditor } from '@/composables/notes/use-note-visual-editor'
import { useNoteVisualLinks } from '@/composables/notes/use-note-visual-links'
import NoteLinkSuggestions from './NoteLinkSuggestions.vue'

const props = defineProps<{ text: string; path: string; paths: string[] }>()
const emit = defineEmits<{
  change: [text: string]
  document: [text: string]
  unsupported: []
  ready: []
  link: []
}>()
const root = useTemplateRef<HTMLDivElement>('root')
let currentView: () => EditorView | undefined = () => undefined
const links = useNoteVisualLinks(
  () => currentView(),
  () => props.path,
  () => props.paths
)
const { popup, matches, active, prepareLink, insertLink } = links
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
function pasteDocument(event: ClipboardEvent) {
  const view = getView()
  const text = event.clipboardData?.getData('text/plain')
  if (!view || !text || !hasNoteFrontmatter(text)) return
  const { doc, selection } = view.state
  if (selection.$from.parent.type.spec.code) return
  const empty =
    doc.childCount === 1 &&
    doc.firstChild?.type.name === 'paragraph' &&
    doc.firstChild.content.size === 0
  const all = selection.from <= 1 && selection.to >= doc.content.size - 1
  if (!empty && !all) return
  // Keep the original YAML before Milkdown treats it as body Markdown or clipboard HTML.
  event.preventDefault()
  event.stopPropagation()
  emit('document', text)
}
defineExpose({ prepareLink, insertLink })
</script>
<template>
  <div class="note-visual" @paste.capture="pasteDocument">
    <q-banner dense v-if="error" class="note-banner text-negative">{{
      error
    }}</q-banner>
    <Teleport to="body">
      <NoteLinkSuggestions
        v-if="popup"
        class="agent-menu note-mention-list"
        :style="{ left: popup.left + 'px', top: popup.top + 'px' }"
        :paths="matches"
        :active="active"
        @select="insertLink($event, true)"
      />
    </Teleport>
    <div ref="root" />
  </div>
</template>
<style>
@import '@milkdown/crepe/theme/common/style.css';
@import '@milkdown/crepe/theme/frame.css';
.note-visual .milkdown {
  --crepe-font-default: var(--font-agent);
  --crepe-font-title: var(--font-agent);
  --crepe-font-code: var(--font-mono);
  --crepe-color-primary: var(--q-primary);
  --crepe-color-background: transparent;
  --crepe-color-on-background: var(--q-dark);
}
/* One Dark keeps a dark active gutter after Crepe replaces the light block background. */
.body--light .note-visual .milkdown .cm-activeLineGutter {
  background-color: #6699ff0b;
}
.body--dark .note-visual .milkdown {
  --crepe-color-on-background: #eee;
  --crepe-color-surface: #292c32;
  --crepe-color-on-surface: #eee;
  --crepe-color-surface-low: #23262b;
  --crepe-color-on-surface-variant: #c6cbd4;
  --crepe-color-primary: #8ab4f8;
  --crepe-color-secondary: #3b475b;
  --crepe-color-on-secondary: #eee;
  --crepe-color-outline: #77808f;
  --crepe-color-hover: #353a44;
  --crepe-color-selected: #414a5b;
  --crepe-color-inline-area: #323843;
  --crepe-color-inline-code: #ffb4ab;
}
.note-visual .milkdown .ProseMirror {
  min-height: 320px;
}
</style>

<style scoped>
.note-mention-list {
  position: fixed;
  z-index: 7000;
  width: 320px;
  max-width: calc(100vw - 16px);
  box-shadow: 0 4px 16px #0003;
}
</style>
