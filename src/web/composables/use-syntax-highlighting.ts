import type { DiffFile } from '@/api/types'
import { createWeightedLru } from '@/utils/weighted-lru'
import {
  hasGrammar,
  tokenizeLines,
  type HighlightedToken,
  type LineDocument,
  type LineTokens,
  type TokenizeOutcome,
  type TokensByLine
} from '@/utils/shiki-engine'
import {
  tokenizeInWorker,
  workerAvailable
} from '@/utils/highlight-worker-client'
import { yieldToEventLoop } from '@/utils/yield-to-event-loop'
import { warmupLines } from '@/utils/warmup-samples'
import { hunkText } from '@/utils/hunk-text'

export type { HighlightedToken, LineTokens, TokensByLine }

// Counts lines. Only the cards that are open ask for tokens, and the cache
// saves a second tokenizing when the virtual list mounts such a card again.
// Tokens take much more heap than hunks (#58). With 20 000 lines, a scroll
// back of about 12 screens does not tokenize a card again. A file larger than
// the limit stays in the cache only until the cache gets the next file. A
// mounted card keeps its own tokens, so this costs time only after a remount.
const TOKEN_CACHE_MAX_LINES = 20_000

// Lines per slice. A slice tokenizes in about 35 ms, and the first slice
// is the first paint of colors.
const SLICE_LINES = 100

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin'
}

export function languageForPath(path: string): string {
  const segments = path.split('.')
  if (segments.length < 2) return 'text'
  const ext = segments.pop()!.toLowerCase()
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text'
}

/** True when a grammar for this path is known. Other paths have no tokens to wait for. */
export function canHighlight(path: string): boolean {
  return hasGrammar(languageForPath(path))
}

/** Tokenizes on the main thread in slices, with a yield between them. */
function tokenizeHere(
  lang: string,
  lines: string[],
  documents: LineDocument[] | undefined,
  signal: AbortSignal | undefined,
  onSlice: (tokens: LineTokens[], start: number) => void
): Promise<TokenizeOutcome> {
  return tokenizeLines(lang, lines, {
    documents,
    sliceSize: SLICE_LINES,
    yieldBetween: yieldToEventLoop,
    signal,
    onSlice
  })
}

/**
 * Tokenizes in the worker, or on the main thread when there is no worker. Each slice goes to
 * `onProgress` as a copy of all tokens so far, so a reader never sees a later change.
 * Gives `null` on a failure and `undefined` when `signal` stopped the work.
 */
async function tokenize(
  lang: string,
  lines: string[],
  signal?: AbortSignal,
  onProgress?: (tokens: TokensByLine) => void,
  documents?: LineDocument[]
): Promise<TokensByLine | null | undefined> {
  const sofar: TokensByLine = []
  const onSlice = (tokens: LineTokens[], start: number) => {
    sofar.splice(start, tokens.length, ...tokens)
    onProgress?.(sofar.slice())
  }

  if (!workerAvailable()) {
    return answer(
      await tokenizeHere(lang, lines, documents, signal, onSlice),
      sofar
    )
  }
  let outcome: TokenizeOutcome | 'unsent' = await tokenizeInWorker(
    lang,
    lines,
    { sliceSize: SLICE_LINES, documents, signal, onSlice }
  )
  // The worker did not get the request, or it died during the request. A repeat writes
  // the same tokens at the same lines, so the reports do not get shorter.
  if (outcome === 'unsent' || (outcome === 'failed' && !workerAvailable())) {
    outcome = await tokenizeHere(lang, lines, documents, signal, onSlice)
  }
  return answer(outcome, sofar)
}

/** Turns an outcome into the answer of {@link tokenize}. */
function answer(
  outcome: TokenizeOutcome,
  tokens: TokensByLine
): TokensByLine | null | undefined {
  if (outcome === 'done') return tokens
  return outcome === 'aborted' ? undefined : null
}

// Languages that are warm or warming up. A refetch of the diff must not warm them up again.
const warmedLangs = new Set<string>()

async function warmUp(lang: string) {
  const tokens = await tokenize(lang, warmupLines(lang)).catch(() => null)
  // A failed warm-up lets the next call try again.
  if (tokens === null) warmedLangs.delete(lang)
}

/**
 * Loads the highlighter and the grammars for these paths before any card asks for
 * tokens. Else the first open card shows plain text while the engine and grammar load.
 * A tiny tokenizing also compiles the grammar, so the first real file is fast.
 * Each language warms up once. After a failure, the next call tries again.
 */
export function warmUpHighlighter(paths: string[]): void {
  const langs = new Set(paths.map(languageForPath).filter(hasGrammar))
  for (const lang of langs) {
    if (warmedLangs.has(lang)) continue
    warmedLangs.add(lang)
    void warmUp(lang)
  }
}

const tokenCache = createWeightedLru<object, TokensByLine | null>(
  TOKEN_CACHE_MAX_LINES,
  tokens => tokens?.length ?? 1
)

// Tokenizing one file blocks the main thread. Expand all can ask for dozens of files
// at once. The queue runs them one by one and yields between jobs, so input stays live.
let highlightQueue: Promise<unknown> = Promise.resolve()

function enqueueHighlight<T>(job: () => Promise<T>): Promise<T> {
  const run = highlightQueue
    .then(() => new Promise(resolve => setTimeout(resolve, 0)))
    .then(job)
  highlightQueue = run.catch(() => undefined)
  return run
}

/**
 * Tokenizes `lines` of the file at `path` and remembers the answer per `key`. One key means
 * one path and one text: a new text needs a new key object. Pass raw objects, not reactive
 * proxies. `lines` is called only when the cache has no answer. `documents` splits the lines into
 * parts with their own grammar state, and the tokens of a part's skipped lines are not returned. A job stopped by `signal`
 * gives `undefined` and is not cached, so a closed card leaves no half answer.
 */
export function highlightCached(
  key: object,
  path: string,
  lines: () => string[],
  signal?: AbortSignal,
  onProgress?: (tokens: TokensByLine) => void,
  documents?: () => LineDocument[] | undefined
): Promise<TokensByLine | null | undefined> {
  return enqueueHighlight(async () => {
    // An earlier job in the queue may have tokenized this text already.
    const cached = tokenCache.get(key)
    if (cached !== undefined) return cached
    if (signal?.aborted) return undefined
    // `lines` first: the getters may share one computation.
    const text = lines()
    const tokens = await tokenize(
      languageForPath(path),
      text,
      signal,
      onProgress,
      documents?.()
    )
    if (tokens === undefined) return undefined
    tokenCache.set(key, tokens)
    return tokens
  })
}

/**
 * Same as {@link highlightCached} for a diff file: one entry per line in hunk order.
 * A new file object means new content, so it is a new key.
 */
export function highlightFileCached(
  file: DiffFile,
  signal?: AbortSignal,
  onProgress?: (tokens: TokensByLine) => void
): Promise<TokensByLine | null | undefined> {
  let text: ReturnType<typeof hunkText> | undefined
  const textOf = () => (text ??= hunkText(file.hunks))
  return highlightCached(
    file,
    file.newPath || file.oldPath,
    () => textOf().lines,
    signal,
    onProgress,
    () => textOf().documents
  )
}

/** The tokens `highlightCached` already holds for this key, without starting work. */
export function cachedHighlight(key: object): TokensByLine | null | undefined {
  return tokenCache.get(key)
}
