export type ServerEventType =
  | 'review:created'
  | 'review:updated'
  | 'review:deleted'
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'files:changed'

export interface ServerEvent {
  type: ServerEventType
  /** Present for review/comment events; omitted for repository-wide events like 'files:changed'. */
  reviewId?: string
}

export type ServerEventListener = (event: ServerEvent) => void

export interface EventBus {
  publish: (event: ServerEvent) => void
  subscribe: (listener: ServerEventListener) => () => void
}

export function createEventBus(): EventBus {
  const listeners = new Set<ServerEventListener>()

  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
