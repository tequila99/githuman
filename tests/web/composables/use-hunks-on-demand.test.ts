import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import { useHunksOnDemand } from '@/composables/use-hunks-on-demand'

function setup(initial: { expanded?: boolean; loaded?: boolean } = {}) {
  const expanded = ref(initial.expanded ?? true)
  const loaded = ref(initial.loaded ?? false)
  const error = ref<string | undefined>(undefined)
  const version = ref<object>({})
  const unrelated = ref(0)
  let calls = 0
  let collapsed = 0
  const scope = effectScope()
  const { bodyMounted } = scope.run(() =>
    useHunksOnDemand({
      expanded,
      // Reads unrelated reactive data, as a store getter can.
      loaded: () => unrelated.value >= 0 && loaded.value,
      error,
      version,
      onNeeded: () => {
        calls++
      },
      onCollapsed: () => {
        collapsed++
      }
    })
  )!
  return {
    expanded,
    loaded,
    error,
    version,
    unrelated,
    bodyMounted,
    scope,
    calls: () => calls,
    collapsed: () => collapsed
  }
}

describe('useHunksOnDemand', () => {
  it('does not ask while the body is not mounted', async () => {
    const s = setup()
    await nextTick()
    assert.equal(s.calls(), 0)
    s.scope.stop()
  })

  it('asks once the open body is mounted and the hunks are missing', async () => {
    const s = setup()
    s.bodyMounted.value = true
    await nextTick()
    assert.equal(s.calls(), 1)
    s.scope.stop()
  })

  it('does not ask when the hunks are loaded', async () => {
    const s = setup({ loaded: true })
    s.bodyMounted.value = true
    await nextTick()
    assert.equal(s.calls(), 0)
    s.scope.stop()
  })

  it('does not ask again after an error', async () => {
    const s = setup()
    s.error.value = 'failed'
    s.bodyMounted.value = true
    await nextTick()
    assert.equal(s.calls(), 0)
    s.scope.stop()
  })

  it('does not ask for a closed card', async () => {
    const s = setup({ expanded: false })
    s.bodyMounted.value = true
    await nextTick()
    assert.equal(s.calls(), 0)
    s.scope.stop()
  })

  it('forgets the mounted body when the card closes', async () => {
    const s = setup({ loaded: true })
    s.bodyMounted.value = true
    await nextTick()
    s.expanded.value = false
    await nextTick()
    assert.equal(s.bodyMounted.value, false)
    s.scope.stop()
  })

  it('asks again when the hunks go stale', async () => {
    const s = setup({ loaded: true })
    s.bodyMounted.value = true
    await nextTick()
    s.loaded.value = false
    await nextTick()
    assert.equal(s.calls(), 1)
    s.scope.stop()
  })

  it('asks again for a new version while the hunks are still missing', async () => {
    const s = setup()
    s.bodyMounted.value = true
    await nextTick()
    assert.equal(s.calls(), 1)
    s.version.value = {}
    await nextTick()
    assert.equal(s.calls(), 2)
    s.scope.stop()
  })

  it('does not ask again on a change of unrelated data', async () => {
    const s = setup()
    s.bodyMounted.value = true
    await nextTick()
    s.unrelated.value++
    await nextTick()
    assert.equal(s.calls(), 1)
    s.scope.stop()
  })

  it('reports a collapse, and does not ask for a closed card', async () => {
    const s = setup()
    s.bodyMounted.value = true
    await nextTick()
    s.expanded.value = false
    await nextTick()
    assert.equal(s.collapsed(), 1)
    s.version.value = {}
    await nextTick()
    assert.equal(s.calls(), 1)
    s.scope.stop()
  })

  it('accepts plain values', async () => {
    let calls = 0
    const scope = effectScope()
    const { bodyMounted } = scope.run(() =>
      useHunksOnDemand({
        expanded: true,
        loaded: false,
        error: undefined,
        version: 1,
        onNeeded: () => {
          calls++
        }
      })
    )!
    bodyMounted.value = true
    await nextTick()
    assert.equal(calls, 1)
    scope.stop()
  })
})
