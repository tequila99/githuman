import { isRecord } from '../utils/guards.ts'
import { errorMessage } from '../utils/error-message.ts'
import { isMap, isSeq, isScalar, parseDocument } from 'yaml'

export function splitNote(text: string) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = text.slice(bom.length)
  if (!/^---\r?\n/.test(source)) {
    return {
      head: bom,
      body: source,
      yaml: '',
      eol: text.includes('\r\n') ? '\r\n' : '\n'
    }
  }
  const match = source.match(/^---\r?\n([\s\S]*?)(?:^---[ \t]*(?:\r?\n|$))/m)
  if (!match) throw new Error('Unclosed YAML frontmatter')
  return {
    head: bom + match[0],
    body: source.slice(match[0].length),
    yaml: match[1] ?? '',
    eol: match[0].includes('\r\n') ? '\r\n' : '\n'
  }
}

export function noteMetadata(text: string): {
  tags: string[]
  error: string | null
} {
  try {
    const { doc } = parseNoteHeader(text)
    const tags = doc.get('tags')
    if (tags === undefined) return { tags: [], error: null }
    if (
      !isSeq(tags) ||
      tags.items.some(item => !isScalar(item) || typeof item.value !== 'string')
    ) {
      throw new Error('tags must be a list of strings')
    }
    return {
      tags: normalizeTags(
        tags.items.map(item => (isScalar(item) ? String(item.value) : ''))
      ),
      error: null
    }
  } catch (error) {
    return {
      tags: [],
      error: errorMessage(error)
    }
  }
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]
}

export function setNoteTags(text: string, tags: string[]): string {
  const metadata = noteMetadata(text)
  if (metadata.error) throw new Error(metadata.error)
  const next = normalizeTags(tags)
  if (JSON.stringify(next) === JSON.stringify(metadata.tags)) return text
  const { parts, doc } = parseNoteHeader(text)
  doc.set('tags', next)
  return writeNoteHeader(text, parts, doc.toString())
}

export interface NoteProperty {
  key: string
  value: unknown
}

function parseNoteHeader(text: string) {
  const parts = splitNote(text)
  const doc = parseDocument(parts.yaml)
  if (doc.errors.length) throw new Error(doc.errors[0]?.message)
  if (doc.contents && !isMap(doc.contents)) {
    throw new Error('Frontmatter must be a YAML mapping')
  }
  return { parts, doc }
}

export function noteProperties(text: string): NoteProperty[] {
  const { doc } = parseNoteHeader(text)
  if (!isMap(doc.contents)) return []
  const values: unknown = doc.toJS({ maxAliasCount: 100 })
  if (!isRecord(values)) return []
  return doc.contents.items.map(item => {
    if (!isScalar(item.key) || typeof item.key.value !== 'string') {
      throw new Error('Property names must be strings')
    }
    const key = item.key.value
    return { key, value: values[key] }
  })
}

export type NotePropertyValue = string | number | boolean | null | string[]

function writeNoteHeader(
  text: string,
  parts: ReturnType<typeof splitNote>,
  yaml: string
) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  return (
    bom +
    '---' +
    parts.eol +
    yaml.replace(/\n/g, parts.eol) +
    '---' +
    parts.eol +
    parts.body
  )
}

export function setNoteProperty(
  text: string,
  key: string,
  value: NotePropertyValue
): string {
  if (!key.trim()) throw new Error('Property name must not be empty')
  if (key === 'tags') {
    if (!Array.isArray(value)) throw new Error('tags must be a list of strings')
    return setNoteTags(text, value)
  }
  const { parts, doc } = parseNoteHeader(text)
  const current = noteProperties(text).find(property => property.key === key)
  if (current && JSON.stringify(current.value) === JSON.stringify(value)) {
    return text
  }
  doc.set(key, value)
  return writeNoteHeader(text, parts, doc.toString())
}

export function removeNoteProperty(text: string, key: string): string {
  const { parts, doc } = parseNoteHeader(text)
  if (!doc.has(key)) return text
  doc.delete(key)
  return writeNoteHeader(text, parts, doc.toString())
}
