import { toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useAgentStore } from '@/stores/agent-store'
import { useNotifyError } from './use-notify-error'

export function useAgentAutoApprove(chatId: MaybeRefOrGetter<string>) {
  const store = useAgentStore()
  const { t } = useI18n()
  const $q = useQuasar()
  const notifyError = useNotifyError()
  async function applyAutoApprove(enabled: boolean, id: string) {
    try {
      await store.setAutoApprove(enabled, id)
    } catch (err) {
      notifyError(t('agent.autoApprove.failed'), err)
    }
  }

  function toggleAutoApprove() {
    const id = toValue(chatId)
    const entry = store.chats[id]
    if (!entry || entry.chat.status === 'closed') return
    if (entry.chat.autoApprove) {
      void applyAutoApprove(false, id)
      return
    }
    $q.dialog({
      title: t('agent.autoApprove.confirmTitle'),
      message: t('agent.autoApprove.confirmMessage'),
      ok: {
        label: t('agent.autoApprove.confirmOk'),
        color: 'negative',
        flat: true,
        noCaps: true
      },
      cancel: { label: t('agent.newChat.cancel'), flat: true, noCaps: true }
    }).onOk(() => {
      void applyAutoApprove(true, id)
    })
  }

  return { toggleAutoApprove }
}
