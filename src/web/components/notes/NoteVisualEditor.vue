<script setup lang="ts">
import { useTemplateRef } from 'vue'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useNoteVisualEditor } from '@/composables/notes/use-note-visual-editor'
import { useNoteVisualLinks } from '@/composables/notes/use-note-visual-links'
import NoteLinkSuggestions from './NoteLinkSuggestions.vue'

const props = defineProps<{ text: string; path: string; paths: string[] }>()
const emit = defineEmits<{
  change: [text: string]
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
defineExpose({ prepareLink, insertLink })
</script>
<template>
  <div class="note-visual">
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
