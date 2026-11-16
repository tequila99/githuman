import { isRecord } from '@/utils/guards'

// Bound parsing and pretty-printing before data reaches the highlighter.
const MAX_JSON_CHARS = 64 * 1024
// Bound traversal and indentation expansion of hostile JSON.
const MAX_JSON_DEPTH = 32
// Recognize the journal's explicit storage marker without changing the source.
const JOURNAL_TRUNCATION = '\n[truncated]'
// ACP extraction already cuts the chat output before it reaches this view.
const CHAT_TRUNCATION = '\n… (truncated)'
// Keep the initial DOM small, including a single long line.
export const TOOL_PREVIEW_CHARS = 8 * 1024
// A preview can grow in bounded steps without mounting an unlimited document.
export const TOOL_MAX_PREVIEW_CHARS = 64 * 1024
// Each step also bounds documents with many short lines.
const PREVIEW_LINES = 100

export interface ToolText {
  text: string
  json: boolean
  limited: boolean
}

export interface ToolContentSection extends ToolText {
  id: string
  label:
    | 'result'
    | 'arguments'
    | 'formatted'
    | 'structured'
    | 'block'
    | 'event'
    | 'source'
  index?: number
}

export interface ToolContent {
  sections: ToolContentSection[]
  truncated: boolean
  toolCallId?: string
  title?: string
  status?: string
}

type Parsed = { ok: true; value: unknown } | { ok: false; limited: boolean }

function bounded(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false
  if (value === null || typeof value !== 'object') return true
  return Object.values(value).every(item => bounded(item, depth + 1))
}

function parse(text: string): Parsed {
  if (text.length > MAX_JSON_CHARS) return { ok: false, limited: true }
  try {
    const value: unknown = JSON.parse(text)
    return bounded(value) ? { ok: true, value } : { ok: false, limited: true }
  } catch {
    return { ok: false, limited: false }
  }
}

function format(value: unknown): ToolText {
  const compact = JSON.stringify(value) ?? ''
  if (compact.length > MAX_JSON_CHARS || !bounded(value)) {
    return { text: compact, json: false, limited: true }
  }
  const pretty = JSON.stringify(value, null, 2) ?? ''
  return pretty.length <= MAX_JSON_CHARS
    ? { text: pretty, json: true, limited: false }
    : { text: compact, json: false, limited: true }
}

export function formatToolText(text: string): ToolText {
  const parsed = parse(text)
  return parsed.ok
    ? format(parsed.value)
    : { text, json: false, limited: parsed.limited }
}

function isMcpResult(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    ((Array.isArray(value.content) &&
      value.content.every(
        block => isRecord(block) && typeof block.type === 'string'
      )) ||
      Object.hasOwn(value, 'structuredContent'))
  )
}

function resultSections(value: unknown): ToolContentSection[] {
  let result = value
  // Only known MCP structures justify removing a transport wrapper.
  if (isRecord(result) && isMcpResult(result.result)) result = result.result
  if (!isMcpResult(result)) {
    return [{ id: 'result', label: 'result', ...display(result) }]
  }
  const sections: ToolContentSection[] = []
  if (Object.hasOwn(result, 'structuredContent')) {
    sections.push({
      id: 'structured',
      label: 'structured',
      ...format(result.structuredContent)
    })
  }
  if (Array.isArray(result.content)) {
    const blocks = result.content
    blocks.forEach((block: unknown, index: number) => {
      sections.push({
        id: `block-${index}`,
        label: blocks.length === 1 ? 'result' : 'block',
        index: index + 1,
        ...(isRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string'
          ? formatToolText(block.text)
          : format(block))
      })
    })
  }
  if (!sections.length) {
    sections.push({ id: 'result', label: 'result', ...format(result) })
  }
  return sections
}

function display(value: unknown): ToolText {
  return typeof value === 'string' ? formatToolText(value) : format(value)
}

export function toolContent(
  source: string,
  kind: 'journal' | 'chat'
): ToolContent {
  const marker = kind === 'journal' ? JOURNAL_TRUNCATION : CHAT_TRUNCATION
  const truncated = source.endsWith(marker)
  const text = truncated ? source.slice(0, -marker.length) : source
  const parsed = parse(text)
  const sections: ToolContentSection[] = []
  const content: ToolContent = { sections, truncated }
  if (kind === 'journal') {
    if (parsed.ok && isRecord(parsed.value)) {
      const event = parsed.value
      for (const key of ['toolCallId', 'title', 'status'] as const) {
        if (typeof event[key] === 'string') content[key] = event[key]
      }
      content.truncated ||= event.truncated === true
      if (event.type === 'tool_result' && Object.hasOwn(event, 'output')) {
        sections.push(...resultSections(event.output))
      } else if (event.type === 'tool_input' && Object.hasOwn(event, 'input')) {
        sections.push({
          id: 'arguments',
          label: 'arguments',
          ...display(event.input)
        })
      } else if (event.type === 'tool' && Object.hasOwn(event, 'output')) {
        sections.push(...resultSections(event.output))
      } else {
        sections.push({ id: 'formatted', label: 'formatted', ...format(event) })
      }
    } else if (parsed.ok) {
      sections.push({
        id: 'formatted',
        label: 'formatted',
        ...format(parsed.value)
      })
    }
  } else if (parsed.ok) {
    sections.push(...resultSections(parsed.value))
  } else {
    sections.push({
      id: 'result',
      label: 'result',
      text: source,
      json: false,
      limited: parsed.limited
    })
  }
  sections.push({
    id: 'source',
    label: kind === 'journal' ? 'event' : 'source',
    text: source,
    json: !truncated && parsed.ok,
    limited: !parsed.ok && parsed.limited
  })
  return content
}

export function toolTextPreview(
  text: string,
  step = 1
): { text: string; hidden: boolean; canExpand: boolean } {
  const maxChars = Math.min(TOOL_MAX_PREVIEW_CHARS, TOOL_PREVIEW_CHARS * step)
  const prefix = text.slice(0, maxChars)
  const lines = prefix.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES * step).join('\n')
  return {
    text: shown,
    hidden: shown.length < text.length,
    canExpand: shown.length < text.length && maxChars < TOOL_MAX_PREVIEW_CHARS
  }
}
