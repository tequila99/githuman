import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { apiPost } from '@/api/client'
import { useFileExplorerStore } from '@/stores/file-explorer-store'

/** Stage/unstage/discard actions for a single file, wired to the sidebar file-list buttons. */
export function useFileActions() {
  const $q = useQuasar()
  const { t } = useI18n()
  const explorer = useFileExplorerStore()

  async function run(path: string, endpoint: string, errorKey: string) {
    try {
      await apiPost(endpoint, { paths: [path] })
      await explorer.refresh()
    } catch (err) {
      $q.notify({
        type: 'negative',
        message: t(errorKey),
        caption: err instanceof Error ? err.message : String(err)
      })
    }
  }

  function stage(path: string) {
    return run(path, '/api/git/stage', 'changes.actions.stageError')
  }

  function unstage(path: string) {
    return run(path, '/api/git/unstage', 'changes.actions.unstageError')
  }

  function discard(path: string) {
    $q.dialog({
      title: t('changes.actions.discardConfirmTitle'),
      message: t('changes.actions.discardConfirmMessage', { path }),
      persistent: true,
      ok: {
        label: t('changes.actions.discardConfirmOk'),
        color: 'negative',
        flat: true
      },
      cancel: {
        label: t('changes.actions.discardConfirmCancel'),
        flat: true
      }
    }).onOk(() => {
      void run(path, '/api/git/discard', 'changes.actions.discardError')
    })
  }

  return { stage, unstage, discard }
}
