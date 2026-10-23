import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ViewportMetrics } from '@/utils/visible-viewport'

export const useViewportStore = defineStore('viewport', () => {
  const metrics = ref<ViewportMetrics>({
    width: 0,
    height: 0,
    scale: 1,
    offsetTop: 0,
    offsetLeft: 0
  })
  const keyboardOpen = ref(false)
  return { metrics, keyboardOpen }
})
