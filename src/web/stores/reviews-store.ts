import { ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet, apiPost } from '@/api/client'
import type { CreateReviewRequest, Review } from '@/api/types'

export interface ReviewFilters {
  search: string
  createdFrom: string | null
  createdTo: string | null
  files: string[]
}

function buildQuery(filters: Partial<ReviewFilters>): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom)
  if (filters.createdTo) params.set('createdTo', filters.createdTo)
  if (filters.files && filters.files.length > 0) {
    params.set('files', filters.files.join(','))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const useReviewsStore = defineStore('reviews', () => {
  const reviews = ref<Review[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchReviews(filters: Partial<ReviewFilters> = {}) {
    loading.value = true
    error.value = null

    try {
      reviews.value = await apiGet<Review[]>(
        `/api/reviews${buildQuery(filters)}`
      )
    } catch (err) {
      reviews.value = []
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function createReview(input: CreateReviewRequest): Promise<Review> {
    const review = await apiPost<Review>('/api/reviews', input)
    reviews.value = [review, ...reviews.value]
    return review
  }

  return { reviews, loading, error, fetchReviews, createReview }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useReviewsStore, import.meta.hot))
}
