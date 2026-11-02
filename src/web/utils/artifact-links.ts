import { computed, shallowReactive } from 'vue'
import type { Artifact } from '@/api/types'
import { artifactsApi } from '@/api/artifacts'
import {
  createArtifactRelationsPage,
  createArtifactAncestryPage
} from '@/utils/artifact-details'
import { errorMessage } from '@/utils/error-message'

// Bound title lookups while retaining only the documents in the current link pages.
const TITLE_CONCURRENCY = 4

export function createArtifactLinks(
  identity: Pick<Artifact, 'id' | 'storeId'>
) {
  const outgoing = createArtifactRelationsPage(identity, 'outgoing')
  const incoming = createArtifactRelationsPage(identity, 'incoming')
  const ancestry = createArtifactAncestryPage(identity)
  const resources = [outgoing, incoming, ancestry]
  const names = shallowReactive({
    titles: new Map<string, string>(),
    loading: false,
    error: null as string | null
  })
  const loading = computed(
    () => names.loading || resources.some(resource => resource.state.loading)
  )
  const stale = computed(
    () =>
      names.error !== null || resources.some(resource => resource.state.stale)
  )
  const error = computed(
    () =>
      [
        ...new Set(
          [
            names.error,
            ...resources.map(resource => resource.state.error)
          ].filter(Boolean)
        )
      ].join('\n') || null
  )
  const hasMore = computed(() =>
    resources.some(resource => resource.state.page?.nextCursor)
  )
  let active = false
  let disposed = false
  let generation = 0
  let dirty = true
  let controller: AbortController | null = null
  function ids() {
    return [
      ...new Set([
        ...(outgoing.state.page?.items.map(edge => edge.targetId) ?? []),
        ...(incoming.state.page?.items.map(edge => edge.sourceId) ?? []),
        ...(ancestry.state.page?.ancestorIds ?? [])
      ])
    ]
  }
  async function loadNames(current: number) {
    if (!active || disposed || current !== generation) return
    const requested = ids()
    const titles = new Map(
      requested
        .filter(id => names.titles.has(id))
        .map(id => [id, names.titles.get(id)!])
    )
    const missing = requested.filter(id => dirty || !titles.has(id))
    const request = new AbortController()
    controller?.abort()
    controller = request
    names.loading = true
    names.error = null
    let failure: string | null = null
    for (let index = 0; index < missing.length; index += TITLE_CONCURRENCY) {
      await Promise.all(
        missing.slice(index, index + TITLE_CONCURRENCY).map(async id => {
          try {
            const artifact = await artifactsApi.get(id, request.signal)
            if (artifact.storeId !== identity.storeId || artifact.id !== id) {
              throw new Error(
                'The linked document belongs to another store or identity.'
              )
            }
            titles.set(id, artifact.title)
          } catch (failureReason) {
            failure ??= errorMessage(failureReason)
          }
        })
      )
      if (disposed || current !== generation) return
    }
    if (disposed || current !== generation) return
    names.titles = titles
    names.error = failure
    names.loading = false
    dirty = failure !== null
  }
  async function setActive(value: boolean) {
    if (disposed) return
    active = value
    const current = ++generation
    controller?.abort()
    names.loading = false
    await Promise.all(resources.map(resource => resource.setActive(value)))
    if (value) await loadNames(current)
  }
  async function invalidate() {
    if (disposed) return
    const current = ++generation
    controller?.abort()
    names.loading = false
    dirty = true
    await Promise.all(resources.map(resource => resource.invalidate()))
    await loadNames(current)
  }
  async function more() {
    if (!active || disposed || loading.value || stale.value) return
    const current = ++generation
    await Promise.all(
      resources
        .filter(resource => resource.state.page?.nextCursor)
        .map(resource => resource.more())
    )
    await loadNames(current)
  }
  function dispose() {
    disposed = true
    ++generation
    controller?.abort()
    names.loading = false
    for (const resource of resources) resource.dispose()
  }
  return {
    outgoing,
    incoming,
    ancestry,
    names,
    loading,
    stale,
    error,
    hasMore,
    setActive,
    invalidate,
    more,
    dispose
  }
}
