import { ref, computed } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiDelete, apiGet, apiPatch } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import type { Comment, DiffFile, Review, ReviewStatus } from '@/api/types'

function decodeDiffFile(file: DiffFile): DiffFile {
  return {
    ...file,
    oldPath: decodeGitPath(file.oldPath),
    newPath: decodeGitPath(file.newPath)
  }
}

export const useReviewDetailStore = defineStore('review-detail', () => {
  const review = ref<Review | null>(null)
  const comments = ref<Comment[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const files = computed<DiffFile[]>(() => {
    if (!review.value) return []
    const snapshot: DiffFile[] = JSON.parse(review.value.snapshotData)
    return snapshot.map(decodeDiffFile)
  })

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

  async function load(reviewId: string) {
    loading.value = true
    error.value = null

    try {
      const [loadedReview, loadedComments] = await Promise.all([
        apiGet<Review>(`/api/reviews/${reviewId}`),
        apiGet<Comment[]>(`/api/reviews/${reviewId}/comments`)
      ])
      review.value = loadedReview
      comments.value = loadedComments
    } catch (err) {
      review.value = null
      comments.value = []
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** Re-fetches only the comment list — used on SSE `comment:*` events, without re-fetching the (immutable) review snapshot. */
  async function refreshComments() {
    if (!review.value) return
    comments.value = await apiGet<Comment[]>(
      `/api/reviews/${review.value.id}/comments`
    )
  }

  async function setStatus(status: ReviewStatus) {
    if (!review.value) return
    review.value = await apiPatch<Review>(`/api/reviews/${review.value.id}`, {
      status
    })
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
    review,
    comments,
    loading,
    error,
    files,
    commentsByFile,
    load,
    refreshComments,
    setStatus,
    editComment,
    deleteComment,
    resolveComment,
    unresolveComment
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useReviewDetailStore, import.meta.hot))
}
