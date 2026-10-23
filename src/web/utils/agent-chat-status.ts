import type { ChatState } from './agent-chat'

export function agentChatStatus(
  chat: Pick<ChatState, 'permissions' | 'status'>
) {
  if (chat.permissions.length) return 'attention'
  if (chat.status === 'closed') return 'closed'
  if (chat.status === 'busy' || chat.status === 'starting') return 'working'
  return 'idle'
}

export function aggregateAgentStatus(
  chats: ReadonlyArray<Pick<ChatState, 'permissions' | 'status'>>
) {
  const states = chats.map(agentChatStatus)
  if (states.includes('attention')) return 'attention'
  if (states.includes('working')) return 'working'
  return null
}
