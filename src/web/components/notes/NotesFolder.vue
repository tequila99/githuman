<script setup lang="ts">
import NoteContextMenu from './NoteContextMenu.vue'
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
const children = computed(() => noteFolderChildren(props.entries, props.folder))
</script>

<template>
  <section class="notes-folder col column no-wrap">
    <div class="notes-folder-path q-pa-lg">{{ folder || t('notes.root') }}</div>
    <NotesFolderContent v-if="children.length">
      <q-btn
        v-for="child in children"
        :key="child.path"
        flat
        no-caps
        class="notes-folder-item"
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
