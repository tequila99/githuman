import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { MAX_AGENT_SESSIONS, type AgentContextItem } from '@/api/types'
import { useAgentStore } from '@/stores/agent-store'
import { errorMessage } from '@/utils/error-message'

export type AgentContextSource =
  | AgentContextItem
  | (() => AgentContextItem | Promise<AgentContextItem>)

export function useAddAgentContext(): (
  source: AgentContextSource
) => Promise<void> {
  const { t } = useI18n()
  const $q = useQuasar()
  const store = useAgentStore()

  return async source => {
    try {
      const item = typeof source === 'function' ? await source() : source
      if (store.addContext(item) === 'limit') {
        $q.notify({
          type: 'warning',
          message: t('agent.chats.limitReached', { max: MAX_AGENT_SESSIONS })
        })
      }
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  }
}
