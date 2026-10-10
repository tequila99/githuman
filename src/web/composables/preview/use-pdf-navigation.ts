import { toRef, toValue, type MaybeRef, type MaybeRefOrGetter } from 'vue'

interface PdfNavigationOptions {
  page: MaybeRef<number>
  pages: MaybeRefOrGetter<number>
  canvas: MaybeRefOrGetter<HTMLCanvasElement | null>
  blocked: MaybeRefOrGetter<boolean>
  onNavigate?: () => void
}

export function usePdfNavigation(options: PdfNavigationOptions) {
  const pageIndex = toRef(options.page)

  function navigate(delta: number) {
    const pages = toValue(options.pages)
    if (!pages) return
    pageIndex.value = Math.max(0, Math.min(pages - 1, pageIndex.value + delta))
    options.onNavigate?.()
  }
  function navigateFromMargin(event: MouseEvent) {
    const canvas = toValue(options.canvas)
    if (
      event.target !== event.currentTarget ||
      !canvas ||
      toValue(options.blocked)
    )
      return
    const bounds = canvas.getBoundingClientRect()
    if (event.clientX < bounds.left) {
      navigate(-1)
    } else if (event.clientX > bounds.right) {
      navigate(1)
    }
  }

  return { navigate, navigateFromMargin }
}
