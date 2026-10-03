import { computed } from 'vue'
import { Dark } from 'quasar'
import { safeStorage } from '@/utils/safe-storage'

const STORAGE_KEY = 'githuman-theme'

export function initAppTheme() {
  const stored = safeStorage.get(STORAGE_KEY)
  Dark.set(stored === 'light' || stored === 'dark' ? stored === 'dark' : 'auto')
}

export function useAppTheme() {
  const isDark = computed(() => Dark.isActive)

  function toggleTheme() {
    Dark.set(!Dark.isActive)
    safeStorage.set(STORAGE_KEY, Dark.isActive ? 'dark' : 'light')
  }

  return { isDark, toggleTheme }
}
