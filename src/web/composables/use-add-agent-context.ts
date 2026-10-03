import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { MAX_AGENT_SESSIONS, type AgentContextItem } from '@/api/types'
import { useAgentStore } from '@/stores/agent-store'

/**
 * "Add to chat" for diffs, files and reviews: goes to the active chat, or
 * opens the new-chat dialog when there is none, or says why it can't.
 */
export function useAddAgentContext(): (item: AgentContextItem) => void {
  const { t } = useI18n()
  const $q = useQuasar()
  const store = useAgentStore()

  return item => {
    if (store.addContext(item) === 'limit') {
      $q.notify({
        type: 'warning',
        message: t('agent.chats.limitReached', { max: MAX_AGENT_SESSIONS })
      })
    }
  }
}
