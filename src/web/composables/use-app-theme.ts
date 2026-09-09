import { computed } from 'vue'
import { Dark } from 'quasar'

const STORAGE_KEY = 'githuman-theme'

export function initAppTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  Dark.set(stored === 'light' || stored === 'dark' ? stored === 'dark' : 'auto')
}

export function useAppTheme() {
  const isDark = computed(() => Dark.isActive)

  function toggleTheme() {
    Dark.set(!Dark.isActive)
    localStorage.setItem(STORAGE_KEY, Dark.isActive ? 'dark' : 'light')
  }

  return { isDark, toggleTheme }
}
