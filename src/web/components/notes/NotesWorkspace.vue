<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NoteDraft } from '@/stores/notes-store'
import type { NoteEntry } from '../../../shared/notes/types.ts'
import NoteHistoryButtons from './NoteHistoryButtons.vue'
import NoteMissing from './NoteMissing.vue'
import type { NoteDescriptor } from '../../../shared/notes/types.ts'
import NotesTree from './NotesTree.vue'
import NotePane from './NotePane.vue'
import NotesFolder from './NotesFolder.vue'

defineProps<{
  entries: NoteEntry[]
  selected: string
  activeFolder: string | null
  draft: NoteDraft | undefined
  paths: string[]
  tags: string[]
  descriptor?: NoteDescriptor | null
  viewState?: { scroll: number; sourceScroll: number; mode: string } | null
  loading: boolean
}>()
const emit = defineEmits<{
  ready: []
  select: [path: string]
  folder: [path: string]
  create: [folder: boolean]
  rename: [path: string, folder: boolean]
  change: [text: string]
  save: []
  reload: []
  copy: []
  link: [href: string, occurrence?: number]
}>()
const { t } = useI18n()
</script>
<template>
  <div class="notes-workspace col row no-wrap">
    <NotesTree
      :entries="entries"
      :selected="activeFolder ?? selected"
      @select="emit('select', $event)"
      @folder="emit('folder', $event)"
      @create="emit('create', $event)"
      @rename="(path, folder) => emit('rename', path, folder)"
    />
    <div class="col column no-wrap notes-workspace-content">
      <NoteHistoryButtons />
      <NotePane
        v-if="
          draft &&
          activeFolder === null &&
          (!descriptor ||
            descriptor.note.presence === 'present' ||
            draft.text !== draft.saved)
        "
        :key="draft.id ?? selected"
        :view-state="viewState ?? null"
        @ready="emit('ready')"
        :draft="draft"
        :paths="paths"
        :tags="tags"
        @change="emit('change', $event)"
        @save="emit('save')"
        @reload="emit('reload')"
        @copy="emit('copy')"
        @link="(href, occurrence) => emit('link', href, occurrence)"
      />
      <NoteMissing
        v-else-if="
          descriptor &&
          activeFolder === null &&
          descriptor.note.presence !== 'present'
        "
        :descriptor="descriptor"
        @select="emit('select', $event)"
      />
      <NotesFolder
        v-else-if="activeFolder !== null"
        :entries="entries"
        :folder="activeFolder"
        @select="emit('select', $event)"
        @folder="emit('folder', $event)"
        @create="emit('create', $event)"
        @rename="(path, folder) => emit('rename', path, folder)"
      />
      <div v-else class="col flex flex-center text-grey q-pa-lg">{{
        loading ? t('notes.loading') : t('notes.choose')
      }}</div>
    </div>
  </div>
</template>
<style scoped>
.notes-workspace-content {
  min-width: 0;
  min-height: 0;
}
.notes-workspace {
  min-height: 0;
}
@media (max-width: 700px) {
  .notes-workspace-content {
    min-width: 0;
    min-height: 0;
  }
  .notes-workspace {
    flex-direction: column;
  }
}
</style>
