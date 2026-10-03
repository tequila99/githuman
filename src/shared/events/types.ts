/**
 * Event names sent over the SSE stream (`GET /api/events`). A runtime list,
 * not just a type: the web client attaches one EventSource listener per
 * name, since EventSource has no catch-all for named events.
 */
export const SERVER_EVENT_TYPES = [
  'review:created',
  'review:updated',
  'review:deleted',
  'comment:created',
  'comment:updated',
  'comment:deleted',
  'files:changed'
] as const

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number]

/** First SSE event. A changed `instanceId` on reconnect means a restart. */
export interface ServerHello {
  instanceId: string
}
