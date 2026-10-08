import type { DiffLineType } from '@/api/types'
import {
  useCardState,
  type CardStateOptions
} from '@/composables/use-card-state'
import type { CommentAnchor } from '@/utils/comment-anchor'

// The body and hunk must read the same slot with the same full type.
const PENDING_DIFF_SLOT = 'pending:diff'

type PendingDiffComment = CommentAnchor & { lineType: DiffLineType }

export function usePendingDiffComment(options: CardStateOptions = {}) {
  return useCardState<PendingDiffComment | null>(
    PENDING_DIFF_SLOT,
    () => null,
    options
  )
}
