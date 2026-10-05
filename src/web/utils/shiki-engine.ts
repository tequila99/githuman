import type { HighlighterCore, LanguageInput } from 'shiki/core'

export interface HighlightedToken {
  content: string
  colorLight?: string | undefined
  colorDark?: string | undefined
}

export type LineTokens = HighlightedToken[]

// Tokens line by line. `null` marks a line without tokens.
export type TokensByLine = (LineTokens | null)[]

/** How a tokenizing ended. The tokens themselves come through `onSlice`. */
export type TokenizeOutcome = 'done' | 'failed' | 'aborted'

/**
 * A part of the lines with its own grammar state. A hunk is such a part: its start does not
 * continue the lines above it.
 */
export interface LineDocument {
  /** Number of lines in the part, the preamble included. */
  length: number
  /** Lines at the start that only give state, a preamble. They get no tokens. */
  skip: number
}

export interface TokenizeOptions {
  /**
   * The parts of the lines, in order. Their lengths add up to the line count. Without it,
   * all lines are one part. The lines that a part skips are not in the tokens: a start
   * given to `onSlice` counts the other lines only.
   */
  documents?: LineDocument[] | undefined
  /** Lines per slice. Without it, one call tokenizes all lines. */
  sliceSize?: number | undefined
  /** Awaited between slices, so the thread can handle input and paint. */
  yieldBetween?: (() => Promise<void>) | undefined
  /** Stops before the next slice. The outcome is then `'aborted'`. */
  signal?: AbortSignal | undefined
  /** Gets the tokens of each slice as soon as they are ready, with the slice start line. */
  onSlice?: ((tokens: LineTokens[], start: number) => void) | undefined
}

// Explicit per-language dynamic imports (not a template literal) so the
// bundler only ever code-splits the handful of grammars this app actually
// supports, instead of every language Shiki ships.
const LANG_LOADERS: Record<string, () => LanguageInput> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs')
}

const THEME_LOADERS = {
  light: () => import('shiki/themes/github-light.mjs'),
  dark: () => import('shiki/themes/github-dark.mjs')
}

const THEMES = { light: 'github-light', dark: 'github-dark' }

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()
// Languages with a load in progress. A warm-up and a real job can ask for the same
// grammar at the same time, and both must wait for one load.
const loadingLangs = new Map<string, Promise<void>>()

/** True when a grammar for this language is known. */
export function hasGrammar(lang: string): boolean {
  return LANG_LOADERS[lang] !== undefined
}

async function loadGrammar(highlighter: HighlighterCore, lang: string) {
  try {
    await highlighter.loadLanguage(LANG_LOADERS[lang]!())
    loadedLangs.add(lang)
  } finally {
    loadingLangs.delete(lang)
  }
}

async function getHighlighter(lang: string): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import('shiki/core'),
          import('shiki/engine/oniguruma')
        ])

      return createHighlighterCore({
        themes: [THEME_LOADERS.light(), THEME_LOADERS.dark()],
        langs: [],
        engine: createOnigurumaEngine(() => import('shiki/wasm'))
      })
    })()
  }

  const highlighter = await highlighterPromise
  if (!loadedLangs.has(lang)) {
    let loading = loadingLangs.get(lang)
    if (!loading) {
      loading = loadGrammar(highlighter, lang)
      loadingLangs.set(lang, loading)
    }
    await loading
  }

  return highlighter
}

/**
 * Tokenizes lines of one language and sends each slice to `onSlice`.
 * Slices carry the grammar state over inside a document, so the tokens equal those of one call.
 * Gives `'failed'` when the language has no grammar, the documents do not fit the lines,
 * or Shiki fails.
 */
export async function tokenizeLines(
  lang: string,
  lines: string[],
  options: TokenizeOptions = {}
): Promise<TokenizeOutcome> {
  if (!hasGrammar(lang) || lines.length === 0) return 'failed'
  const documents = options.documents ?? [{ length: lines.length, skip: 0 }]
  const total = documents.reduce((sum, document) => sum + document.length, 0)
  if (total !== lines.length) return 'failed'
  const { signal } = options

  try {
    const highlighter = await getHighlighter(lang)
    // The first line of the document in `lines`, and the lines given to `onSlice` so far.
    let base = 0
    let reported = 0
    let firstSlice = true

    for (const document of documents) {
      let state: ReturnType<HighlighterCore['getLastGrammarState']> | undefined
      const size = Math.max(1, options.sliceSize ?? document.length)

      for (let at = 0; at < document.length; at += size) {
        if (!firstSlice) await options.yieldBetween?.()
        firstSlice = false
        // The engine load and each yield give time for a stop.
        if (signal?.aborted) return 'aborted'

        const end = Math.min(at + size, document.length)
        const shikiTokens = highlighter.codeToTokensWithThemes(
          lines.slice(base + at, base + end).join('\n'),
          { lang, themes: THEMES, ...(state ? { grammarState: state } : {}) }
        )
        state = highlighter.getLastGrammarState(shikiTokens)

        // The skipped lines of the preamble still give the state above.
        const from = Math.max(at, document.skip)
        if (end <= from) continue
        options.onSlice?.(
          shikiTokens.slice(from - at).map(tokens =>
            tokens.map(token => ({
              content: token.content,
              colorLight: token.variants.light?.color,
              colorDark: token.variants.dark?.color
            }))
          ),
          reported
        )
        reported += end - from
      }
      base += document.length
    }
    return 'done'
  } catch {
    return 'failed'
  }
}
