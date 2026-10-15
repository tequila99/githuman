<script setup lang="ts">
import { noteParentPath } from '../../../shared/notes/note-path.ts'
import NoteContextMenu from './NoteContextMenu.vue'
import { useNoteDragDrop } from '@/composables/notes/use-note-drag-drop'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiFolderPlusOutline } from '@mdi/js'
import type { NoteEntry } from '../../../shared/notes/types.ts'
import { noteFolderChildren } from '@/utils/note-navigation'

import NotesFolderEmpty from './NotesFolderEmpty.vue'
import NotesFolderContent from './NotesFolderContent.vue'
import NotesFolderCreateFab from './NotesFolderCreateFab.vue'

const props = defineProps<{ entries: NoteEntry[]; folder: string }>()
const emit = defineEmits<{
  select: [path: string]
  folder: [path: string]
  create: [folder: boolean]
  rename: [path: string, folder: boolean]
}>()
const { t } = useI18n()
const drag = useNoteDragDrop()
const parent = computed(() => noteParentPath(props.folder))
const children = computed(() => noteFolderChildren(props.entries, props.folder))
</script>

<template>
  <section
    class="notes-folder col column no-wrap note-drop-zone"
    :class="{ 'note-drop-active': drag.hovered.value === folder }"
    @dragover="drag.over($event, folder)"
    @dragleave="drag.leave"
    @drop="drag.drop($event, folder)"
  >
    <div class="notes-folder-path q-pa-lg row items-center q-gutter-sm">
      <q-btn
        v-if="folder"
        flat
        round
        dense
        color="grey-7"
        icon="arrow_upward"
        class="note-drop-zone"
        :class="{ 'note-drop-active': drag.hovered.value === parent }"
        :aria-label="t('notes.parentFolder')"
        @click="emit('folder', parent)"
        @dragover="drag.over($event, parent)"
        @dragleave="drag.leave"
        @drop="drag.drop($event, parent)"
      />
      <span>{{ folder || t('notes.root') }}</span>
    </div>
    <NotesFolderContent v-if="children.length">
      <q-btn
        v-for="child in children"
        :key="child.path"
        flat
        no-caps
        class="notes-folder-item note-drop-zone"
        :class="{
          'note-drop-active': child.folder && drag.hovered.value === child.path
        }"
        :draggable="!child.folder"
        @dragstart="drag.start($event, child.path)"
        @dragend="drag.end"
        @dragover="child.folder && drag.over($event, child.path)"
        @dragleave="child.folder && drag.leave($event)"
        @drop="child.folder && drag.drop($event, child.path)"
        @click="
          child.folder ? emit('folder', child.path) : emit('select', child.path)
        "
      >
        <NoteContextMenu
          :path="child.path"
          :folder="child.folder"
          @rename="(path, folder) => emit('rename', path, folder)"
        />
        <span class="column items-center full-width">
          <q-icon
            :name="child.folder ? 'folder' : 'insert_drive_file'"
            :color="child.folder ? 'warning' : 'grey-6'"
            size="72px"
            class="q-mb-sm"
          />
          <span class="notes-folder-name">{{ child.label }}</span>
        </span>
      </q-btn>
    </NotesFolderContent>
    <NotesFolderEmpty v-else>
      <template #title>{{ folder || t('notes.root') }}</template>
      {{ t('notes.folderEmpty') }}
      <template #actions>
        <q-btn
          flat
          no-caps
          icon="add"
          :label="t('notes.newNote')"
          @click="emit('create', false)"
        />
        <q-btn
          flat
          no-caps
          :icon="mdiFolderPlusOutline"
          :label="t('notes.newFolder')"
          @click="emit('create', true)"
        />
      </template>
    </NotesFolderEmpty>
    <NotesFolderCreateFab @create="emit('create', $event)" />
  </section>
</template>

<style scoped>
.notes-folder {
  position: relative;
  min-width: 0;
  min-height: 0;
  font-family: var(--font-agent);
}
.notes-folder-path {
  overflow-wrap: anywhere;
  max-width: 100%;
  font-weight: 400;
}
</style>
