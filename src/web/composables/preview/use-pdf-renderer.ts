import {
  onMounted,
  onBeforeUnmount,
  readonly,
  shallowRef,
  toRef,
  toValue,
  watch,
  type MaybeRef,
  type MaybeRefOrGetter,
  type WatchStopHandle
} from 'vue'
import {
  getDocument,
  PDFWorker,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
  type PDFDocumentLoadingTask
} from 'pdfjs-dist'
import { errorMessage } from '@/utils/error-message'

// Limit a page bitmap to about 16 MiB, even on high-density screens or at large zoom levels.
const MAX_CANVAS_PIXELS = 4 * 1024 * 1024
// Cap pixel density to avoid oversized canvases on high-density displays.
const MAX_PIXEL_RATIO = 2
// Auxiliary PDF assets are served locally in development and production.
const PDF_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`

interface PdfRendererOptions {
  file: MaybeRefOrGetter<File>
  canvas: MaybeRefOrGetter<HTMLCanvasElement | null>
  page: MaybeRef<number>
  scale: MaybeRefOrGetter<number>
  onRendered?: () => void
}

export function usePdfRenderer(options: PdfRendererOptions) {
  const pageIndex = toRef(options.page)
  const pages = shallowRef(0)
  const busy = shallowRef(true)
  const error = shallowRef<string | null>(null)
  let stop: WatchStopHandle | undefined

  onMounted(() => {
    stop = watch(
      toRef(options.file),
      (file, _previous, onCleanup) => {
        let document: PDFDocumentProxy | null = null
        let loading: PDFDocumentLoadingTask | null = null
        let worker: PDFWorker | null = null
        let port: Worker | null = null
        let page: PDFPageProxy | null = null
        let task: RenderTask | null = null
        let generation = 0
        let disposed = false
        let queue: Promise<void> = Promise.resolve()
        pages.value = 0
        busy.value = true
        error.value = null

        function requestRender() {
          const version = ++generation
          task?.cancel()
          queue = queue.then(() => renderPage(version))
        }
        async function renderPage(version: number) {
          const target = toValue(options.canvas)
          if (disposed || version !== generation || !document || !target) return
          busy.value = true
          error.value = null
          try {
            page?.cleanup()
            page = await document.getPage(pageIndex.value + 1)
            if (disposed || version !== generation) return
            const viewport = page.getViewport({ scale: toValue(options.scale) })
            const density = Math.min(
              window.devicePixelRatio || 1,
              MAX_PIXEL_RATIO,
              Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height))
            )
            target.width = Math.max(1, Math.floor(viewport.width * density))
            target.height = Math.max(1, Math.floor(viewport.height * density))
            target.style.width = `${viewport.width}px`
            target.style.height = `${viewport.height}px`
            task = page.render({
              canvas: target,
              viewport,
              transform: [density, 0, 0, density, 0, 0]
            })
            await task.promise
            if (!disposed && version === generation) options.onRendered?.()
          } catch (failure) {
            if (!disposed && version === generation)
              error.value = errorMessage(failure)
          } finally {
            task = null
            if (!disposed && version === generation) busy.value = false
          }
        }
        async function load() {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (disposed) return
            port = new Worker(
              new URL('../../workers/pdf.worker.ts', import.meta.url),
              {
                type: 'module'
              }
            )
            worker = PDFWorker.create({ port })
            loading = getDocument({
              data: bytes,
              worker,
              disableAutoFetch: true,
              disableStream: true,
              cMapUrl: `${PDF_ASSET_BASE}cmaps/`,
              cMapPacked: true,
              standardFontDataUrl: `${PDF_ASSET_BASE}standard_fonts/`,
              wasmUrl: `${PDF_ASSET_BASE}wasm/`
            })
            document = await loading.promise
            if (disposed) return
            pages.value = document.numPages
            pageIndex.value = Math.max(
              0,
              Math.min(pageIndex.value, pages.value - 1)
            )
            requestRender()
          } catch (failure) {
            if (!disposed) {
              error.value = errorMessage(failure)
              busy.value = false
            }
          }
        }
        const stopRender = watch(
          [toRef(options.scale), pageIndex, toRef(options.canvas)],
          requestRender
        )
        onCleanup(() => {
          disposed = true
          generation++
          stopRender()
          task?.cancel()
          void loading?.destroy().catch(() => {})
          worker?.destroy()
          port?.terminate()
        })
        void load()
      },
      { immediate: true }
    )
  })
  onBeforeUnmount(() => {
    stop?.()
    const target = toValue(options.canvas)
    if (target) {
      target.width = 0
      target.height = 0
    }
  })

  return {
    pages: readonly(pages),
    busy: readonly(busy),
    error: readonly(error)
  }
}
