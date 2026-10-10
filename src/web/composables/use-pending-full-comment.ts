import {
  useCardState,
  type CardStateOptions
} from '@/composables/use-card-state'
import type { CommentAnchor } from '@/utils/comment-anchor'

// The shell and full-file rows must share one anchor slot and type.
const PENDING_FULL_SLOT = 'pending:full'

export function usePendingFullComment(options: CardStateOptions = {}) {
  return useCardState<CommentAnchor | null>(
    PENDING_FULL_SLOT,
    () => null,
    options
  )
}
