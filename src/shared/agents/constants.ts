/** Chats open at once (ADR 0024); the server refuses more, the UI hides "add". */
export const MAX_AGENT_SESSIONS = 5

/** Raw bytes per attachment; shared by the upload UI and the server. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const DEFAULT_FILE_SEARCH_LIMIT = 30
export const MAX_FILE_SEARCH_LIMIT = 100
