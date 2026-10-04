import type { HighlighterCore, LanguageInput } from 'shiki/core'
import type { DiffFile } from '@/api/types'
import { createWeightedLru } from '@/utils/weighted-lru'

// Counts lines. Only the cards that are open ask for tokens, and the cache
// saves a second tokenizing when the virtual list mounts such a card again.
// Tokens take much more heap than hunks (#58). With 20 000 lines, a scroll
// back of about 12 screens does not tokenize a card again. A file larger than
// the limit stays in the cache only until the cache gets the next file. A
// mounted card keeps its own tokens, so this costs time only after a remount.
const TOKEN_CACHE_MAX_LINES = 20_000

export interface HighlightedToken {
  content: string
  colorLight?: string | undefined
  colorDark?: string | undefined
}

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

export function languageForPath(path: string): string {
  const segments = path.split('.')
  if (segments.length < 2) return 'text'
  const ext = segments.pop()!.toLowerCase()
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text'
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

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
    await highlighter.loadLanguage(LANG_LOADERS[lang]!())
    loadedLangs.add(lang)
  }

  return highlighter
}

async function tokenizeLines(
  lang: string,
  lines: string[]
): Promise<(HighlightedToken[] | null)[] | null> {
  if (lang === 'text' || !LANG_LOADERS[lang] || lines.length === 0) return null

  try {
    const highlighter = await getHighlighter(lang)
    const tokenLines = highlighter.codeToTokensWithThemes(lines.join('\n'), {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' }
    })

    return tokenLines.map(tokens =>
      tokens.map(token => ({
        content: token.content,
        colorLight: token.variants.light?.color,
        colorDark: token.variants.dark?.color
      }))
    )
  } catch {
    return null
  }
}

/**
 * Tokenizes every line across all hunks of a diff file for syntax
 * highlighting. Returns one entry per line in hunk order, or null if the
 * language is unrecognized or highlighting fails (callers fall back to
 * plain text).
 */
export async function highlightFile(
  file: DiffFile
): Promise<(HighlightedToken[] | null)[] | null> {
  const lines = file.hunks.flatMap(hunk => hunk.lines.map(line => line.content))
  return tokenizeLines(languageForPath(file.newPath || file.oldPath), lines)
}

/**
 * Tokenizes a plain list of lines (e.g. a whole file's content read outside
 * a diff) for syntax highlighting. Same fallback behavior as
 * {@link highlightFile}.
 */
export async function highlightLines(
  path: string,
  lines: string[]
): Promise<(HighlightedToken[] | null)[] | null> {
  return tokenizeLines(languageForPath(path), lines)
}

const tokenCache = createWeightedLru<
  DiffFile,
  (HighlightedToken[] | null)[] | null
>(TOKEN_CACHE_MAX_LINES, tokens => tokens?.length ?? 1)

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
 * Same as {@link highlightFile}, but remembers the answer per diff file
 * object. A new object means new content, so it is a new key. Pass the raw
 * object, not a reactive proxy. A job aborted before its turn does no work
 * and gives `undefined`: a card that closed or left the window needs no tokens.
 */
export function highlightFileCached(
  file: DiffFile,
  signal?: AbortSignal
): Promise<(HighlightedToken[] | null)[] | null | undefined> {
  return enqueueHighlight(async () => {
    // An earlier job in the queue may have tokenized this file already.
    const cached = tokenCache.get(file)
    if (cached !== undefined) return cached
    if (signal?.aborted) return undefined
    const tokens = await highlightFile(file)
    tokenCache.set(file, tokens)
    return tokens
  })
}

/** The tokens `highlightFileCached` already holds, without starting work. */
export function cachedHighlight(
  file: DiffFile
): (HighlightedToken[] | null)[] | null | undefined {
  return tokenCache.get(file)
}
