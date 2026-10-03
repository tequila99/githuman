import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { apiPost } from '@/api/client'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useNotifyError } from '@/composables/use-notify-error'

/** Stage/unstage/discard actions for a single file, wired to the sidebar file-list buttons. */
export function useFileActions() {
  const $q = useQuasar()
  const { t } = useI18n()
  const notifyError = useNotifyError()
  const explorer = useFileExplorerStore()
  const activeReview = useActiveReviewStore()

  async function run(path: string, endpoint: string, errorKey: string) {
    try {
      await apiPost(endpoint, { paths: [path] })
      await explorer.refresh()
    } catch (err) {
      notifyError(t(errorKey), err)
    }
  }

  /** Staging a file with open review threads is usually premature — ask first. */
  function stage(path: string): Promise<void> | void {
    const unresolved = (activeReview.commentsByFile.get(path) ?? []).filter(
      comment => !comment.resolved
    ).length
    if (unresolved === 0) {
      return run(path, '/api/git/stage', 'changes.actions.stageError')
    }
    $q.dialog({
      title: t('changes.actions.stageUnresolvedTitle'),
      message: t('changes.actions.stageUnresolvedMessage', {
        path,
        count: unresolved
      }),
      persistent: true,
      ok: { label: t('changes.actions.stageUnresolvedOk'), flat: true },
      cancel: { label: t('changes.actions.discardConfirmCancel'), flat: true }
    }).onOk(() => {
      void run(path, '/api/git/stage', 'changes.actions.stageError')
    })
    return undefined
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
