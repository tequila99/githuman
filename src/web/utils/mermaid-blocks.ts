import DOMPurify from 'dompurify'
import { mermaidRenderer } from './mermaid-render'

interface DiagramRenderer {
  render: (source: string, dark: boolean) => Promise<string>
}

/**
 * Second line of defence: mermaid's strict mode already sanitizes labels, but
 * the diagram text comes from an agent that may itself have been steered by
 * hostile code, so the SVG is cleaned again before it goes into the page.
 * Labels are HTML inside <foreignObject>, which DOMPurify must be told about.
 */
function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    // Labels never need these, and an <img> would load whatever URL the agent likes.
    FORBID_TAGS: [
      'img',
      'picture',
      'source',
      'video',
      'audio',
      'iframe',
      'form',
      'input',
      'button',
      'a'
    ],
    HTML_INTEGRATION_POINTS: { foreignobject: true }
  })
}

/**
 * mermaid scales a diagram to its container (`width: 100%` plus a max-width),
 * which turns the text of any non-trivial diagram into specks in a narrow chat
 * panel. Pin the SVG to its natural size instead; the box scrolls.
 */
function useNaturalSize(box: HTMLElement): void {
  const svg = box.querySelector('svg')
  const viewBox = svg
    ?.getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  const width = viewBox?.[2]
  if (!svg || width === undefined || !Number.isFinite(width) || width <= 0) {
    return
  }
  svg.style.maxWidth = 'none'
  svg.style.width = `${Math.round(width)}px`
  svg.style.height = 'auto'
}

/**
 * Turns the ```mermaid code blocks inside a rendered markdown message into
 * diagrams. The markdown stays the source of truth: a block that can't be
 * parsed (or one still streaming in half-written) simply stays a code block,
 * and diagrams already drawn are redrawn when the theme flips.
 */
export async function enhanceMermaidBlocks(
  root: HTMLElement,
  dark: boolean,
  renderer: DiagramRenderer = mermaidRenderer,
  failedLabel = 'Could not draw the diagram',
  isCurrent: () => boolean = () => true
): Promise<void> {
  const theme = dark ? 'dark' : 'light'
  const targets: { el: HTMLElement; source: string }[] = []

  for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
    const pre = code.parentElement
    if (pre) targets.push({ el: pre, source: code.textContent ?? '' })
  }
  for (const drawn of root.querySelectorAll<HTMLElement>('.agent-mermaid')) {
    if (drawn.dataset.theme !== theme) {
      targets.push({ el: drawn, source: drawn.dataset.source ?? '' })
    }
  }

  await Promise.all(
    targets.map(async ({ el, source }) => {
      if (source.trim() === '') return
      try {
        const svg = await renderer.render(source, dark)
        // The message may have re-rendered (streaming) while we were waiting.
        if (!el.isConnected || !root.contains(el) || !isCurrent()) return
        const box = document.createElement('div')
        box.className = 'agent-mermaid'
        box.dataset.source = source
        box.dataset.theme = theme
        box.innerHTML = sanitizeSvg(svg)
        useNaturalSize(box)
        // MarkdownContent opens the diagram on click or Enter.
        box.tabIndex = 0
        box.setAttribute('role', 'button')
        el.replaceWith(box)
      } catch (error) {
        if (!el.isConnected || !root.contains(el) || !isCurrent()) return
        el.classList.add('agent-mermaid--invalid')
        // Say why: the source is the agent's, and mermaid is strict about it.
        if (!el.nextElementSibling?.classList.contains('agent-mermaid-error')) {
          const note = document.createElement('div')
          note.className = 'agent-mermaid-error'
          const reason =
            error instanceof Error ? error.message.split('\n')[0] : ''
          note.textContent = reason
            ? `${failedLabel}: ${reason.slice(0, 200)}`
            : failedLabel
          el.after(note)
        }
      }
    })
  )
}
