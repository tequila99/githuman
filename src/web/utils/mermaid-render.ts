/** Rendered diagrams kept per renderer; the oldest one is dropped beyond this. */
const MAX_CACHED_DIAGRAMS = 50

/** The slice of the mermaid API we use; lets tests swap in a fake. */
export interface MermaidLike {
  initialize: (config: {
    startOnLoad: false
    securityLevel: 'strict'
    suppressErrorRendering: true
    theme: 'dark' | 'default'
    look: 'classic'
    fontSize: number
    themeVariables: { fontSize: string }
    themeCSS: string
  }) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

/**
 * Renders mermaid source to an SVG string, with the library loaded lazily on
 * the first diagram (it is by far the heaviest dependency of the app).
 *
 * - Results are cached by theme + source, so a chat message that re-renders
 *   on every streamed chunk doesn't re-lay-out the same diagram — and a
 *   diagram that failed to parse stays failed instead of being retried.
 * - mermaid renders into shared global state, so calls run one at a time.
 * - `securityLevel: 'strict'` makes mermaid sanitize labels itself; the SVG it
 *   returns is what ends up in v-html.
 */
export function createMermaidRenderer(load: () => Promise<MermaidLike>) {
  const cache = new Map<string, Promise<string>>()
  let queue: Promise<unknown> = Promise.resolve()
  let configuredTheme: string | null = null
  let counter = 0

  async function renderNow(source: string, dark: boolean): Promise<string> {
    const mermaid = await load()
    const theme = dark ? 'dark' : 'default'
    if (configuredTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme,
        look: 'classic',
        fontSize: 12,
        themeVariables: { fontSize: '12px' },
        themeCSS:
          '.label div, .label span, .label p { line-height: 1.25 !important; }'
      })
      configuredTheme = theme
    }
    counter += 1
    const { svg } = await mermaid.render(`agent-mermaid-${counter}`, source)
    return svg
  }

  return {
    render(source: string, dark: boolean): Promise<string> {
      const key = `${dark ? 'dark' : 'light'}\n${source}`
      const cached = cache.get(key)
      if (cached) {
        // Re-insert: a Map iterates in insertion order, so the first key is the least recently used.
        cache.delete(key)
        cache.set(key, cached)
        return cached
      }
      const result = queue.then(() => renderNow(source, dark))
      queue = result.catch(() => undefined)
      cache.set(key, result)
      if (cache.size > MAX_CACHED_DIAGRAMS) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      return result
    }
  }
}

async function loadMermaid(): Promise<MermaidLike> {
  const { default: mermaid } = await import('mermaid')
  return {
    initialize: config => mermaid.initialize(config),
    async render(id, text) {
      try {
        return await mermaid.render(id, text)
      } catch (error) {
        // A failed render can leave its scratch element in <body>.
        document.getElementById(`d${id}`)?.remove()
        throw error
      }
    }
  }
}

export const mermaidRenderer = createMermaidRenderer(loadMermaid)
