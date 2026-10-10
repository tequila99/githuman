import { shallowRef, markRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import { safeStorage } from '@/utils/safe-storage'
import { isRecord } from '@/utils/guards'
import type { WindowApplication } from '@/types/windows/window'

/** Registration does not couple the dock to application components or data. */
export function createApplicationRegistry() {
  const applications = shallowRef<readonly WindowApplication[]>([])
  function register(application: WindowApplication): () => void {
    if (applications.value.some(item => item.id === application.id)) {
      throw new Error(`Application already registered: ${application.id}`)
    }
    const entry = { ...application }
    if (entry.component) entry.component = markRaw(entry.component)
    const persistence = application.persistence
    const key = `githuman:application:${application.id}`
    if (persistence) {
      try {
        const saved: unknown = JSON.parse(safeStorage.get(key) ?? 'null')
        if (isRecord(saved) && typeof saved.version === 'number')
          persistence.restore(saved.data, saved.version)
      } catch {
        /* An invalid application state must not block other applications. */
      }
    }
    const stop = persistence
      ? watch(
          () => persistence.serialize(),
          value => {
            safeStorage.set(
              key,
              JSON.stringify({ version: persistence.version, data: value })
            )
          },
          { deep: true }
        )
      : () => {}
    applications.value = [...applications.value, entry]
    return () => {
      stop()
      applications.value = applications.value.filter(item => item !== entry)
    }
  }
  return { applications, register }
}

/** Public entry point for trusted applications and widgets in this browser tab. */
export const useApplicationRegistry = defineStore(
  'window-applications',
  createApplicationRegistry
)
