<script setup lang="ts">
import NotesIssues from '@/components/notes/NotesIssues.vue'
import NoteRenameDialog from '@/components/notes/NoteRenameDialog.vue'
import { shallowRef, useTemplateRef } from 'vue'
import AppPage from '@/components/AppPage.vue'
import NotesStorageBanners from '@/components/notes/NotesStorageBanners.vue'
import NotesWorkspace from '@/components/notes/NotesWorkspace.vue'
import { useNotesStore } from '@/stores/notes-store'
import { useNotesRouting } from '@/composables/notes/use-notes-routing'
import { useNotesDialogs } from '@/composables/notes/use-notes-dialogs'
import { useNotesPageLifecycle } from '@/composables/notes/use-notes-page-lifecycle'
const renameTarget = shallowRef<{ path: string; folder: boolean } | null>(null)
const store = useNotesStore()
const panel = useTemplateRef<HTMLElement>('panel')
const flush = useNotesPageLifecycle(store)
const {
  activeFolder,
  creationFolder,
  paths,
  tags,
  select,
  selectFolder,
  showNote,
  follow,
  viewState,
  restoreView
} = useNotesRouting(store, { flush, panel })
const { create, reload } = useNotesDialogs(store, {
  creationFolder,
  selectFolder,
  showNote
})
function renamed(path: string, target: string) {
  if (
    activeFolder.value === path ||
    activeFolder.value?.startsWith(path + '/')
  ) {
    void selectFolder(target + activeFolder.value.slice(path.length))
  }
}
</script>
<template>
  <AppPage>
    <div ref="panel" class="notes-page column no-wrap fit">
      <NotesStorageBanners
        :error="store.error"
        :warning="store.index.warning"
        @retry="store.refresh"
      />
      <NotesIssues />
      <NoteRenameDialog
        v-if="renameTarget"
        :key="renameTarget.path"
        :path="renameTarget.path"
        :folder="renameTarget.folder"
        @close="renameTarget = null"
        @renamed="renamed"
      />
      <NotesWorkspace
        :entries="store.index.entries"
        :selected="store.selected"
        :active-folder="activeFolder"
        :draft="store.current"
        :paths="paths"
        :tags="tags"
        :loading="store.loading"
        :descriptor="store.descriptor"
        :view-state="viewState"
        @ready="restoreView"
        @select="select"
        @folder="selectFolder"
        @create="create"
        @rename="(path, folder) => (renameTarget = { path, folder })"
        @change="text => store.edit(store.selected, text)"
        @save="store.save()"
        @reload="reload"
        @copy="create(false, true)"
        @link="follow"
      />
    </div>
  </AppPage>
</template>
<style lang="scss" src="../css/notes.scss"></style>
