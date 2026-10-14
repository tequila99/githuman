<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  useTemplateRef,
  watch,
  nextTick,
  onMounted
} from 'vue'
import type { NoteDraft } from '@/stores/notes-store'
import { useNoteEditor } from '@/composables/notes/use-note-editor'
import {
  useNoteEditorLinks,
  type NoteLinkEditor
} from '@/composables/notes/use-note-editor-links'
import NoteSourceEditor from './NoteSourceEditor.vue'
import NoteProperties from './NoteProperties.vue'
import NoteLinkPicker from './NoteLinkPicker.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteStateBanners from './NoteStateBanners.vue'

const NoteVisualEditor = defineAsyncComponent(
  () => import('./NoteVisualEditor.vue')
)
const props = defineProps<{
  viewState?: { scroll: number; sourceScroll: number; mode: string } | null
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
const {
  mode,
  metadata,
  parts,
  editorError,
  visualUnsupported,
  unsupported,
  visualReady,
  changeBody
} = useNoteEditor(
  () => props.draft.text,
  text => emit('change', text)
)
const visual = useTemplateRef<NoteLinkEditor>('visual')
const source = useTemplateRef<NoteLinkEditor>('source')
const activeEditor = computed(() =>
  mode.value === 'visual' ? visual.value : source.value
)
const { linkOpen, prepareLink, insertLink, follow } = useNoteEditorLinks(
  activeEditor,
  (href, occurrence) => emit('link', href, occurrence)
)
function restoreMode() {
  if (props.viewState?.mode === 'source' || metadata.value.error) {
    mode.value = 'source'
  } else if (props.viewState?.mode === 'visual') {
    mode.value = 'visual'
  }
}
function ready() {
  visualReady()
  emit('ready')
}
watch(() => props.viewState, restoreMode, { immediate: true })
watch(mode, async () => {
  await nextTick()
  emit('ready')
})
onMounted(() => emit('ready'))
</script>
<template>
  <section class="note-pane col column no-wrap">
    <NoteToolbar
      v-model="mode"
      :path="draft.path"
      :status="draft.status"
      :visual-disabled="!!metadata.error"
      @insert-link="prepareLink"
    />
    <NoteStateBanners
      :draft="draft"
      :editor-error="editorError"
      :visual-unsupported="visualUnsupported"
      @save="emit('save')"
      @reload="emit('reload')"
      @copy="emit('copy')"
    />
    <div
      class="note-body col column no-wrap q-pa-md"
      :data-note-mode="mode"
      :class="{ scroll: mode === 'visual' }"
      @click.capture="follow"
      @auxclick.capture="follow"
    >
      <NoteProperties
        v-if="mode === 'visual' && !metadata.error"
        :text="draft.text"
        :path="draft.path"
        :paths="paths"
        :tags="props.tags"
        @change="emit('change', $event)"
      />
      <NoteSourceEditor
        v-if="mode === 'source'"
        ref="source"
        :text="draft.text"
        :path="draft.path"
        :paths="paths"
        @change="emit('change', $event)"
      />
      <NoteVisualEditor
        v-else
        ref="visual"
        :key="draft.revision"
        :text="parts.body"
        :path="draft.path"
        :paths="paths"
        @link="linkOpen = true"
        @change="changeBody"
        @unsupported="unsupported"
        @ready="ready"
      />
    </div>
    <NoteLinkPicker v-model="linkOpen" :paths="paths" @select="insertLink" />
  </section>
</template>
<style scoped>
.note-pane {
  min-width: 0;
  min-height: 0;
}
.note-body {
  min-height: 0;
}
</style>
