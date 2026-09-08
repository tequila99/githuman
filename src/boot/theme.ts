import { defineBoot } from '#q-app'
import { initAppTheme } from '@/composables/use-app-theme'

export default defineBoot(() => {
  initAppTheme()
})
