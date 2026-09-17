import { ref, computed } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/api/client'
import type {
  Comment,
  CreateCommentRequest,
  Review,
  ReviewStatus
} from '@/api/types'

/**
 * The review comments on the Changes page attach to — the most recently
 * created `in_progress` review on the current branch (see ADR 0018). Unlike
 * `review-detail-store.ts` (one specific, already-known review id), this
 * store has to first figure out *which* review that is.
 */
export const useActiveReviewStore = defineStore('active-review', () => {
  const activeReview = ref<Review | null>(null)
  const comments = ref<Comment[]>([])
  const loading = ref(false)

  const commentsByFile = computed<Map<string, Comment[]>>(() => {
    const map = new Map<string, Comment[]>()
    for (const comment of comments.value) {
      const list = map.get(comment.filePath)
      if (list) {
        list.push(comment)
      } else {
        map.set(comment.filePath, [comment])
      }
    }
    return map
  })

  async function refresh() {
    loading.value = true

    try {
      const reviews = await apiGet<Review[]>('/api/reviews')
      const inProgress = reviews
        .filter(review => review.status === 'in_progress')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      activeReview.value = inProgress[0] ?? null

      comments.value = activeReview.value
        ? await apiGet<Comment[]>(
            `/api/reviews/${activeReview.value.id}/comments`
          )
        : []
    } finally {
      loading.value = false
    }
  }

  /** Adopts a review created elsewhere (ReviewCreateDialog.vue's `created` event) as active. */
  function setActiveReview(review: Review) {
    activeReview.value = review
    comments.value = []
  }

  async function setStatus(status: ReviewStatus) {
    if (!activeReview.value) return
    await apiPatch<Review>(`/api/reviews/${activeReview.value.id}`, { status })
    // Only in_progress reviews qualify as "active" — after e.g. approving,
    // the patched review must disappear from the Changes page, so recompute
    // the active review from scratch instead of keeping the patched one.
    await refresh()
  }

  async function createComment(input: CreateCommentRequest): Promise<Comment> {
    if (!activeReview.value) throw new Error('No active review')
    const comment = await apiPost<Comment>(
      `/api/reviews/${activeReview.value.id}/comments`,
      input
    )
    comments.value = [...comments.value, comment]
    return comment
  }

  async function editComment(id: string, content: string) {
    const updated = await apiPatch<Comment>(`/api/comments/${id}`, { content })
    comments.value = comments.value.map(comment =>
      comment.id === id ? updated : comment
    )
  }

  async function deleteComment(id: string) {
    await apiDelete(`/api/comments/${id}`)
    comments.value = comments.value.filter(comment => comment.id !== id)
  }

  async function resolveComment(id: string) {
    const updated = await apiPatch<Comment>(`/api/comments/${id}/resolve`)
    comments.value = comments.value.map(comment =>
      comment.id === id ? updated : comment
    )
  }

  async function unresolveComment(id: string) {
    const updated = await apiPatch<Comment>(`/api/comments/${id}/unresolve`)
    comments.value = comments.value.map(comment =>
      comment.id === id ? updated : comment
    )
  }

  return {
    activeReview,
    comments,
    loading,
    commentsByFile,
    refresh,
    setActiveReview,
    setStatus,
    createComment,
    editComment,
    deleteComment,
    resolveComment,
    unresolveComment
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useActiveReviewStore, import.meta.hot))
}
