<script setup lang="ts">
import { watch, nextTick, useTemplateRef, computed } from 'vue'
import type { QTree } from 'quasar'
import NoteContextMenu from './NoteContextMenu.vue'
import { useNotesTree } from '@/composables/notes/use-notes-tree'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import NoteFilters from './NoteFilters.vue'
import NotesRootButton from './NotesRootButton.vue'
import NewNoteButton from './NewNoteButton.vue'
import NewNoteFolderButton from './NewNoteFolderButton.vue'
import type { NoteEntry } from '../../../shared/notes/types.ts'
const props = defineProps<{ entries: NoteEntry[]; selected: string }>()
const emit = defineEmits<{
  select: [path: string]
  folder: [path: string]
  create: [folder: boolean]
  rename: [path: string, folder: boolean]
}>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const {
  query,
  filter,
  nodes,
  filtering,
  visibleExpanded,
  entryByPath,
  reveal
} = useNotesTree(() => props.entries)
const tree = useTemplateRef<QTree>('tree')
const selectedHidden = computed(
  () =>
    !!props.selected &&
    !!entryByPath.value.get(props.selected) &&
    !tree.value?.getNodeByKey(props.selected)
)
watch(
  () => props.selected,
  async path => {
    reveal(path)
    await nextTick()
    tree.value?.scrollTo(path)
  },
  { immediate: true }
)
function select(path: string | null) {
  if (!path) return
  const entry = entryByPath.value.get(path)
  if (entry && !entry.folder) {
    emit('select', path)
  } else {
    emit('folder', path)
  }
}
</script>
<template>
  <aside class="notes-tree q-pa-md column no-wrap">
    <div class="notes-tree-toolbar row items-center q-mb-sm">
      <NotesRootButton @click="emit('folder', '')" />
      <q-space />
      <NewNoteButton @click="emit('create', false)" />
      <NewNoteFolderButton @click="emit('create', true)" />
      <NoteFilters v-model="filter" :entries="entries" />
    </div>
    <q-input
      :dark="isDark"
      v-model="query"
      dense
      outlined
      clearable
      :label="t('notes.search')"
      @clear="query = ''"
    />
    <q-tree
      ref="tree"
      virtual-scroll
      class="notes-tree-list col scroll q-mt-sm"
      :dark="isDark"
      :text-color="isDark ? 'grey-3' : 'dark'"
      :nodes="nodes"
      node-key="id"
      :selected="selected"
      no-selection-unset
      v-model:expanded="visibleExpanded"
      @update:selected="select"
    >
      <template #default-header="{ node, expanded }">
        <div class="notes-tree-header row items-center no-wrap q-gutter-x-xs">
          <q-icon
            :name="
              node.folder
                ? expanded
                  ? 'folder_open'
                  : 'folder'
                : 'insert_drive_file'
            "
            :color="node.folder ? 'warning' : 'grey-6'"
            size="xs"
          />
          <span class="notes-tree-label ellipsis">{{ node.label }}</span>
          <NoteContextMenu
            :path="node.id"
            :folder="node.folder"
            @rename="(path, folder) => emit('rename', path, folder)"
          />
        </div>
      </template>
    </q-tree>
    <p v-if="selectedHidden" class="text-caption text-grey">{{
      t('notes.selectedHidden')
    }}</p>
    <p v-if="!nodes.length" class="text-grey">{{
      t(filtering ? 'notes.noMatches' : 'notes.empty')
    }}</p>
  </aside>
</template>
<style scoped>
.notes-tree {
  font-family: var(--font-agent);
  flex-shrink: 0;
  min-height: 0;
  width: 280px;
  min-width: 220px;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
}
.notes-tree-list {
  min-height: 0;
}
.notes-tree-header {
  min-width: 0;
  flex: 1;
}
.notes-tree-label {
  min-width: 0;
}
.notes-tree-toolbar :deep(.q-btn) {
  color: #757575;
}
.body--dark .notes-tree-toolbar :deep(.q-btn) {
  color: #bdbdbd;
}
.notes-tree-toolbar :deep(.q-btn .q-icon) {
  font-size: 20px;
}
.notes-tree :deep(.q-tree__node-header:focus-visible) {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
@media (max-width: 700px) {
  .notes-tree {
    width: 100%;
    height: 35vh;
    max-height: 35vh;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
}
</style>
