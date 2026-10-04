/**
 * Re-exported from the domain modules in src/shared, the actual source of truth shared
 * with the backend — this file exists only so web code can import via
 * `@/api/types` instead of a relative path reaching out of src/web/.
 */
export type {
  RepositoryInfo,
  FileTreeNode,
  FileTreeResponse,
  FileContentResponse
} from '../../shared/git/types.ts'
export type { AppInfo } from '../../shared/app/types.ts'
export type {
  DiffFileStatus,
  DiffLineType,
  DiffLine,
  DiffHunk,
  DiffFile,
  DiffFileSummary
} from '../../shared/diff/types.ts'
export type { ApiError } from '../../shared/http/types.ts'
export type {
  ReviewStatus,
  ReviewSourceType,
  Review,
  CreateReviewRequest,
  UpdateReviewRequest
} from '../../shared/reviews/types.ts'
export type {
  Comment,
  CreateCommentRequest,
  UpdateCommentRequest
} from '../../shared/comments/types.ts'
export type { ServerEventType, ServerHello } from '../../shared/events/types.ts'
export type {
  AgentPresetInfo,
  AgentSessionStatus,
  AgentSessionInfo,
  CreateAgentSessionRequest,
  AgentContextItem,
  AgentPromptRequest,
  AgentToolDiff,
  AgentToolStatus,
  AgentPermissionOption,
  AgentChatEvent,
  AgentChatEnvelope,
  AgentSessionState,
  AgentPermissionRequest,
  AgentStreamEnvelope,
  AgentSetAutoApproveRequest,
  AgentFileSearchResponse,
  AgentPermissionAnswer,
  AgentConfigOption,
  AgentConfigChoice,
  AgentSetConfigRequest
} from '../../shared/agents/types.ts'

// A value export can't keep the .ts extension (only `export type` can).
export { SERVER_EVENT_TYPES } from '../../shared/events/types'
export { MAX_AGENT_SESSIONS } from '../../shared/agents/constants'
export { uniqueChatName } from '../../shared/agents/chat-names'
