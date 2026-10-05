import { tokenizeLines } from '@/utils/shiki-engine'
import type {
  HighlightRequest,
  HighlightResponse
} from '@/workers/highlight-protocol'

/**
 * A stand-in for the highlight worker in Node, which has no `Worker`. `postMessage` clones the
 * message with `structuredClone`, as a browser does, so data that cannot go to a real worker
 * fails here too. In `auto` mode it answers with real tokens; in `manual` mode it answers
 * only through `reply` and `fail`.
 */
export class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  static mode: 'auto' | 'manual' = 'auto'
  static throwOnCreate = false
  /** A request for this language makes `postMessage` throw, as for data that cannot be cloned. */
  static unclonableLang: string | null = null
  /** Requests for these languages answer `ok: false`, as a failed tokenizing does. */
  static failingLangs = new Set<string>()

  messages: HighlightRequest[] = []
  terminated = false
  private running = new Map<number, AbortController>()

  constructor(_url: URL | string, _options?: WorkerOptions) {
    super()
    if (FakeWorker.throwOnCreate) throw new Error('blocked by the test')
    FakeWorker.instances.push(this)
  }

  postMessage(message: HighlightRequest) {
    if (
      message.type === 'tokenize' &&
      message.lang === FakeWorker.unclonableLang
    ) {
      throw new DOMException('could not be cloned', 'DataCloneError')
    }
    const copy = structuredClone(message)
    this.messages.push(copy)
    if (FakeWorker.mode === 'auto') void this.handle(copy)
  }

  terminate() {
    this.terminated = true
  }

  reply(response: HighlightResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }

  /** Acts as a worker that died. */
  fail() {
    this.dispatchEvent(new Event('error'))
  }

  /** The tokenize requests sent so far. */
  requests() {
    return this.messages.filter(message => message.type === 'tokenize')
  }

  private async handle(message: HighlightRequest) {
    if (message.type === 'cancel') {
      this.running.get(message.id)?.abort()
      return
    }
    if (FakeWorker.failingLangs.has(message.lang)) {
      setTimeout(() => this.reply({ type: 'done', id: message.id, ok: false }))
      return
    }
    const controller = new AbortController()
    this.running.set(message.id, controller)
    const outcome = await tokenizeLines(message.lang, message.lines, {
      sliceSize: message.sliceSize,
      documents: message.documents,
      yieldBetween: () => new Promise(resolve => setTimeout(resolve, 0)),
      signal: controller.signal,
      onSlice: (tokens, start) =>
        this.reply({ type: 'slice', id: message.id, start, tokens })
    })
    this.running.delete(message.id)
    this.reply({ type: 'done', id: message.id, ok: outcome === 'done' })
  }
}

/** Puts the fake worker in `globalThis` and resets its settings. */
export function installFakeWorker(mode: 'auto' | 'manual' = 'auto') {
  FakeWorker.instances = []
  FakeWorker.mode = mode
  FakeWorker.throwOnCreate = false
  FakeWorker.unclonableLang = null
  FakeWorker.failingLangs = new Set()
  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
}

export async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
