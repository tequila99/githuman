import { computed } from 'vue'
import { Dark, LocalStorage } from 'quasar'

const STORAGE_KEY = 'githuman-theme'

export function initAppTheme() {
  const stored = LocalStorage.getItem(STORAGE_KEY)
  Dark.set(stored === 'light' || stored === 'dark' ? stored === 'dark' : 'auto')
}

export function useAppTheme() {
  const isDark = computed(() => Dark.isActive)

  function toggleTheme() {
    Dark.set(!Dark.isActive)
    LocalStorage.set(STORAGE_KEY, Dark.isActive ? 'dark' : 'light')
  }

  return { isDark, toggleTheme }
}
