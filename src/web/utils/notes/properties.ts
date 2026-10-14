import type {
  NoteProperty,
  NotePropertyValue
} from '../../../shared/notes/document.ts'
import { wikiReference } from '../../../shared/notes/reference-path.ts'
import { noteLink } from '../../../shared/notes/links.ts'

export type NotePropertyType =
  | 'text'
  | 'list'
  | 'date'
  | 'number'
  | 'boolean'
  | 'complex'
  | 'tags'

// Creation supports only values editable in the properties panel.
export const NOTE_PROPERTY_CREATE_TYPES = [
  'text',
  'list',
  'number',
  'boolean',
  'date'
] as const

// Icons keep property rows consistent across value editors.
const PROPERTY_ICONS: Record<NotePropertyType, string> = {
  text: 'notes',
  tags: 'sell',
  list: 'format_list_bulleted',
  date: 'calendar_today',
  number: 'tag',
  boolean: 'check_box',
  complex: 'data_object'
}

export type NotePropertyCreateType = (typeof NOTE_PROPERTY_CREATE_TYPES)[number]

export function notePropertyIcon(type: NotePropertyType): string {
  return PROPERTY_ICONS[type]
}

export function notePropertyInitialValue(
  key: string,
  type: NotePropertyCreateType
): NotePropertyValue {
  if (key.trim() === 'tags' || type === 'list') return []
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'date') return new Date().toISOString().slice(0, 10)
  return ''
}

export function notePropertyType(property: NoteProperty): NotePropertyType {
  if (property.key === 'tags') return 'tags'
  const value = property.value
  if (Array.isArray(value)) {
    return value.every(item => typeof item === 'string') ? 'list' : 'complex'
  }
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value !== null && typeof value === 'object') return 'complex'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T00:00:00Z')
    if (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    ) {
      return 'date'
    }
  }
  return 'text'
}

export function notePropertyLink(
  value: unknown,
  from: string,
  paths: readonly string[]
): { href: string; label: string; external: boolean } | null {
  if (typeof value !== 'string') return null
  if (/^https?:\/\//i.test(value)) {
    return { href: value, label: value, external: true }
  }
  const wiki = wikiReference(value, from, paths)
  if (!wiki || wiki.ambiguous) return null
  if (!wiki.path) return { href: value, label: wiki.label, external: false }
  const path = wiki.path
  const anchor = wiki.anchor
  return {
    href:
      noteLink(from, path) + (anchor ? '#' + encodeURIComponent(anchor) : ''),
    label: wiki.label,
    external: false
  }
}

export function notePropertyDisplay(
  value: unknown,
  type: NotePropertyType,
  locale: string
): string {
  if (type === 'date' && typeof value === 'string') {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(value + 'T00:00:00Z'))
  }
  if (value === null || value === undefined) return ''
  if (type === 'complex') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return '[Circular YAML value]'
    }
  }
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : ''
}
