import { singleFlight } from '@/utils/single-flight'
import {
  provide,
  inject,
  onUnmounted,
  shallowRef,
  type InjectionKey
} from 'vue'

// Scope detail refresh callbacks to the current artifact pane.
const REFRESH_KEY: InjectionKey<Set<() => Promise<void>>> =
  Symbol('artifact-refresh')

export function provideArtifactRefresh(refreshDocument: () => Promise<void>) {
  const callbacks = new Set<() => Promise<void>>()
  const loading = shallowRef(false)
  provide(REFRESH_KEY, callbacks)
  const refresh = singleFlight(async () => {
    loading.value = true
    try {
      await Promise.allSettled([
        refreshDocument(),
        ...Array.from(callbacks, callback => callback())
      ])
    } finally {
      loading.value = false
    }
  })
  return { loading, refresh }
}

export function registerArtifactRefresh(callback: () => Promise<void>) {
  const callbacks = inject(REFRESH_KEY, undefined)
  callbacks?.add(callback)
  onUnmounted(() => callbacks?.delete(callback))
}
