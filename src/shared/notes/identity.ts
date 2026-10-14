import { isScalar, parseDocument } from 'yaml'
import { isUuid } from '../utils/is-uuid.ts'
import { splitNote, setNoteProperty } from './document.ts'

export function noteIdentity(text: string): {
  id: string | null
  warning: string | null
} {
  try {
    const doc = parseDocument(splitNote(text).yaml)
    const value = doc.get('githuman_id', true)
    if (value === undefined) return { id: null, warning: null }
    if (isScalar(value) && isUuid(value.value)) {
      return { id: value.value.toLowerCase(), warning: null }
    }
    return {
      id: null,
      warning: 'githuman_id must be a UUID. The catalog identity is unchanged.'
    }
  } catch {
    return { id: null, warning: null }
  }
}

export function withNoteIdentity(text: string, id: string): string {
  return setNoteProperty(text, 'githuman_id', id)
}
