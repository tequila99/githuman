<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  useTemplateRef,
  watch,
  watchEffect
} from 'vue'
import type { NoteDraft } from '@/stores/notes-store'
import {
  useNoteEditor,
  type NoteEditorMode
} from '@/composables/notes/use-note-editor'
import { useNoteEditorLinks } from '@/composables/notes/use-note-editor-links'
import { useNoteEditorPosition } from '@/composables/notes/use-note-editor-position'
import type { NoteViewState } from '@/composables/notes/use-notes-history-state'
import NoteSourceEditor from './NoteSourceEditor.vue'
import NoteProperties from './NoteProperties.vue'
import NoteLinkPicker from './NoteLinkPicker.vue'

const NoteVisualEditor = defineAsyncComponent(
  () => import('./NoteVisualEditor.vue')
)
const props = defineProps<{
  draft: NoteDraft
  paths: string[]
  tags: string[]
  viewState?: NoteViewState | null
}>()
const mode = defineModel<NoteEditorMode>({ required: true })
const emit = defineEmits<{
  change: [text: string]
  ready: []
  state: [
    state: {
      editorError: string
      visualUnsupported: boolean
      metadataError: boolean
    }
  ]
  link: [href: string, occurrence?: number]
}>()
const {
  metadata,
  parts,
  editorError,
  visualUnsupported,
  unsupported,
  visualReady,
  changeBody,
  importDocument,
  visualVersion
} = useNoteEditor(
  () => props.draft.text,
  text => emit('change', text),
  mode
)
const visual = useTemplateRef('visual')
const source = useTemplateRef('source')
const body = useTemplateRef<HTMLElement>('body')
const activeEditor = computed(() =>
  mode.value === 'visual' ? visual.value : source.value
)
const { linkOpen, prepareLink, insertLink, follow } = useNoteEditorLinks(
  activeEditor,
  (href, occurrence) => emit('link', href, occurrence)
)
const position = useNoteEditorPosition(
  body,
  mode,
  text => emit('change', text),
  () => visualVersion.value++
)
let visualText = parts.value.body
function ready() {
  position.ready()
  visualReady()
  emit('ready')
}
watch(
  () => props.viewState,
  () => {
    if (props.viewState?.mode === 'source' || metadata.value.error) {
      mode.value = 'source'
    } else if (props.viewState?.mode === 'visual') {
      mode.value = 'visual'
    }
  },
  { immediate: true }
)
watch(mode, async (current, previous) => {
  if (previous === 'visual') visualText = parts.value.body
  if (
    current === 'visual' &&
    (visualText !== parts.value.body || visualUnsupported.value)
  ) {
    visualVersion.value++
  }
  await nextTick()
  emit('ready')
})
watchEffect(() =>
  emit('state', {
    editorError: editorError.value,
    visualUnsupported: visualUnsupported.value,
    metadataError: Boolean(metadata.value.error)
  })
)
defineExpose({ prepareLink, apply: position.apply })
</script>
<template>
  <div
    ref="body"
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
      :tags="tags"
      @change="emit('change', $event)"
    />
    <KeepAlive :max="1">
      <NoteSourceEditor
        v-if="mode === 'source'"
        ref="source"
        :text="draft.text"
        :path="draft.path"
        :paths="paths"
        @change="emit('change', $event)"
      />
    </KeepAlive>
    <KeepAlive :max="1">
      <NoteVisualEditor
        v-if="mode === 'visual'"
        ref="visual"
        :key="`${draft.revision}:${visualVersion}`"
        :text="parts.body"
        :path="draft.path"
        :paths="paths"
        @link="linkOpen = true"
        @change="changeBody"
        @document="text => importDocument(text, draft.id)"
        @unsupported="unsupported"
        @ready="ready"
      />
    </KeepAlive>
  </div>
  <NoteLinkPicker v-model="linkOpen" :paths="paths" @select="insertLink" />
</template>
<style scoped>
.note-body {
  min-height: 0;
}
</style>
