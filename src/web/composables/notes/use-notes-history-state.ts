import { shallowRef } from 'vue'
import { useRouter, type Router } from 'vue-router'

export interface NoteViewState {
  scroll: number
  sourceScroll: number
  mode: string
}

// Keep view state across Notes page remounts for the same router.
const HISTORIES = new WeakMap<Router, ReturnType<typeof createHistory>>()

function createHistory(router: Router) {
  const current = shallowRef<number | null>(null)
  const views = new Map<number, NoteViewState>()
  function position() {
    const value = router.options.history.state.position
    return typeof value === 'number' ? value : null
  }
  let popped = false
  router.options.history.listen(() => {
    popped = true
  })
  function update(isPop = false) {
    const next = position()
    if (next === null) return
    if (!isPop && next !== current.value) {
      for (const pos of views.keys()) if (pos >= next) views.delete(pos)
    }
    current.value = next
  }
  router.afterEach((_to, _from, failure) => {
    const isPop = popped
    popped = false
    if (!failure) update(isPop)
  })
  update()
  return {
    views,
    position,
    currentPosition: current
  }
}

export function useNotesHistoryState() {
  const router = useRouter()
  let history = HISTORIES.get(router)
  if (!history) {
    history = createHistory(router)
    HISTORIES.set(router, history)
  }
  return history
}
