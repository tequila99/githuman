import { noteCreationPath, validNoteEntryName } from '@/utils/notes/entry-name'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import type { useNotesStore } from '@/stores/notes-store'

type DialogStore = Pick<
  ReturnType<typeof useNotesStore>,
  'index' | 'folder' | 'create' | 'saveCopy' | 'reloadDisk'
>

export function useNotesDialogs(
  store: DialogStore,
  options: {
    creationFolder: MaybeRefOrGetter<string>
    selectFolder: (path: string) => Promise<void>
    showNote: () => void | Promise<void>
  }
) {
  const $q = useQuasar()
  const { t } = useI18n()
  function create(folder: boolean, copy = false) {
    const parent = toValue(options.creationFolder)
    $q.dialog({
      title: t(
        folder ? 'notes.newFolder' : copy ? 'notes.saveCopy' : 'notes.newNote'
      ),
      message: t(folder ? 'notes.folderNameHint' : 'notes.noteNameHint', {
        folder: parent || t('notes.root')
      }),
      prompt: { model: '', type: 'text', isValid: validNoteEntryName },
      cancel: true,
      persistent: true
    }).onOk(async (name: string) => {
      if (!validNoteEntryName(name)) return
      const target = noteCreationPath(parent, name, folder)
      if (folder) {
        await store.folder(target)
        if (
          store.index.entries.some(
            entry => entry.folder && entry.path === target
          )
        ) {
          await options.selectFolder(target)
        }
      } else if (copy) {
        if (await store.saveCopy(target)) await options.showNote()
      } else {
        if (await store.create(target)) await options.showNote()
      }
    })
  }
  function reload() {
    $q.dialog({
      title: t('notes.loadDisk'),
      message: t('notes.discard'),
      cancel: true
    }).onOk(() => {
      void store.reloadDisk()
    })
  }
  return { create, reload }
}
