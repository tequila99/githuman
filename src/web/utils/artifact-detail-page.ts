import { shallowReactive } from 'vue'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'

export function createArtifactDetailPage<
  Page extends { storeId: string },
  Cursor
>(options: {
  storeId: string
  fetch: (cursor: Cursor | null, signal: AbortSignal) => Promise<Page>
  cursor: (page: Page) => Cursor | null
  validate: (page: Page) => void
  append: (previous: Page, next: Page) => Page
}) {
  const state = shallowReactive<{
    page: Page | null
    loading: boolean
    stale: boolean
    error: string | null
  }>({
    page: null,
    loading: false,
    stale: false,
    error: null
  })
  let active = false
  let disposed = false
  let generation = 0
  let controller: AbortController | null = null

  function validate(page: Page) {
    if (page.storeId !== options.storeId) {
      throw new Error('The details belong to another artifact store.')
    }
    options.validate(page)
  }

  const refresh = singleFlight(async () => {
    if (!active || disposed) return
    const current = ++generation
    controller?.abort()
    const request = new AbortController()
    controller = request
    state.loading = true
    state.error = null
    try {
      const page = await options.fetch(null, request.signal)
      if (current !== generation || disposed) return
      validate(page)
      state.page = page
      state.stale = false
    } catch (err) {
      if (current !== generation || disposed) return
      state.error = errorMessage(err)
      state.stale = true
    } finally {
      if (controller === request) controller = null
      if (current === generation) state.loading = false
    }
  })

  async function more() {
    const previous = state.page
    if (!active || disposed || state.loading || state.stale || !previous) return
    const cursor = options.cursor(previous)
    if (cursor === null) return
    const current = generation
    const request = new AbortController()
    controller = request
    state.loading = true
    state.error = null
    try {
      const page = await options.fetch(cursor, request.signal)
      if (current !== generation || disposed) return
      validate(page)
      state.page = options.append(previous, page)
    } catch (err) {
      if (current !== generation || disposed) return
      state.error = errorMessage(err)
      state.stale = true
    } finally {
      if (controller === request) controller = null
      if (current === generation) state.loading = false
    }
  }

  function setActive(value: boolean) {
    if (disposed) return Promise.resolve()
    if (!value && active && state.loading) {
      ++generation
      controller?.abort()
      state.loading = false
      state.stale = true
    }
    active = value
    return value && (!state.page || state.stale) ? refresh() : Promise.resolve()
  }

  function invalidate() {
    ++generation
    controller?.abort()
    state.stale = true
    state.loading = false
    return active && !disposed ? refresh() : Promise.resolve()
  }

  function dispose() {
    disposed = true
    controller?.abort()
    active = false
    ++generation
    state.page = null
    state.loading = false
  }
  return { state, refresh, more, setActive, invalidate, dispose }
}
