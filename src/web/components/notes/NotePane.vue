<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import type { NoteDraft } from '@/stores/notes-store'
import type { NoteEditorMode } from '@/composables/notes/use-note-editor'
import type { NoteViewState } from '@/composables/notes/use-notes-history-state'
import NoteEditorBody from './NoteEditorBody.vue'
import NoteExternalAssetsController from './NoteExternalAssetsController.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteStateBanners from './NoteStateBanners.vue'

defineProps<{
  viewState?: NoteViewState | null
  draft: NoteDraft
  paths: string[]
  tags: string[]
}>()
const emit = defineEmits<{
  ready: []
  change: [text: string]
  save: []
  reload: []
  copy: []
  link: [href: string, occurrence?: number]
}>()
const editorState = shallowRef({
  editorError: '',
  visualUnsupported: false,
  metadataError: false
})
const mode = shallowRef<NoteEditorMode>('visual')
const pane = useTemplateRef<HTMLElement>('pane')
const editor = useTemplateRef('editor')
const assets = useTemplateRef('assets')
onMounted(() => emit('ready'))
</script>
<template>
  <section ref="pane" class="note-pane col column no-wrap">
    <NoteToolbar
      v-model="mode"
      :path="draft.path"
      :status="draft.status"
      :visual-disabled="editorState.metadataError"
      @insert-link="editor?.prepareLink()"
      @download-assets="assets?.open()"
    />
    <NoteStateBanners
      :draft="draft"
      :editor-error="editorState.editorError"
      :visual-unsupported="editorState.visualUnsupported"
      @save="emit('save')"
      @reload="emit('reload')"
      @copy="emit('copy')"
    />
    <NoteEditorBody
      ref="editor"
      v-model="mode"
      :draft="draft"
      :paths="paths"
      :tags="tags"
      :view-state="viewState ?? null"
      @state="editorState = $event"
      @change="emit('change', $event)"
      @ready="emit('ready')"
      @link="(href, occurrence) => emit('link', href, occurrence)"
    />
    <NoteExternalAssetsController
      ref="assets"
      :draft="draft"
      :pane="pane"
      @apply="(text, edits) => editor?.apply(text, edits)"
    />
  </section>
</template>
<style scoped>
.note-pane {
  min-width: 0;
  min-height: 0;
}
</style>
