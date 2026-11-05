import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'

/** Names the chat that sent a request; an unknown session shows its ID. */
export function useArtifactSessionLabel() {
  const { t } = useI18n()
  const agent = useAgentStore()
  return (sessionId: string): string =>
    agent.chats[sessionId]?.info.name ??
    t('artifacts.actions.noSession', { id: sessionId })
}
