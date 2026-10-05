import { tokenizeLines } from '@/utils/shiki-engine'
import { yieldToEventLoop } from '@/utils/yield-to-event-loop'
import type {
  HighlightRequest,
  HighlightResponse
} from '@/workers/highlight-protocol'

// Requests that may still be stopped, by id.
const running = new Map<number, AbortController>()

function reply(response: HighlightResponse) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker has no target origin
  self.postMessage(response)
}

async function handle(message: HighlightRequest) {
  if (message.type === 'cancel') {
    running.get(message.id)?.abort()
    return
  }

  const controller = new AbortController()
  running.set(message.id, controller)
  const outcome = await tokenizeLines(message.lang, message.lines, {
    sliceSize: message.sliceSize,
    documents: message.documents,
    yieldBetween: yieldToEventLoop,
    signal: controller.signal,
    onSlice: (tokens, start) =>
      reply({ type: 'slice', id: message.id, start, tokens })
  })
  running.delete(message.id)
  reply({ type: 'done', id: message.id, ok: outcome === 'done' })
}

// Tokenizes off the main thread and sends each slice at once, so the page can paint the
// first lines while the rest is on the way. A yield between slices lets a cancel arrive.
self.addEventListener('message', (event: MessageEvent<HighlightRequest>) => {
  void handle(event.data)
})
