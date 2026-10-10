import {
  PREVIEW_MIN_SCALE,
  PREVIEW_MAX_SCALE
} from '@/constants/windows/constants'
import { isRecord, isFiniteNumber } from '@/utils/guards'
import type { PreviewSource, PreviewTab } from '@/types/windows/preview'

// The FNV-1a 32-bit offset basis gives preview fingerprints a stable initial value.
const FNV_OFFSET_BASIS = 2166136261
// The FNV-1a 32-bit prime mixes each code unit into the fingerprint.
const FNV_PRIME = 16777619

/** A compact identity avoids storing document or attachment contents in preferences. */
export function previewFingerprint(text: string): string {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return `${text.length}:${hash >>> 0}`
}
export function previewSourceKey(source: PreviewSource): string {
  if (source.type === 'local') return JSON.stringify(['local', source.id])
  return source.type === 'file'
    ? JSON.stringify(['file', source.ref, source.path])
    : JSON.stringify(['message', source.sessionId, source.messageId])
}
export function parsePreviewTab(value: unknown): PreviewTab | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.fingerprint !== 'string'
  )
    return null
  if (
    value.kind !== 'markdown' &&
    value.kind !== 'diagram' &&
    value.kind !== 'image'
  )
    return null
  const raw = value.source
  if (!isRecord(raw)) return null
  let source: PreviewSource
  if (
    raw.type === 'file' &&
    typeof raw.path === 'string' &&
    typeof raw.ref === 'string' &&
    raw.path &&
    raw.ref
  ) {
    source = { type: 'file', path: raw.path, ref: raw.ref }
  } else if (
    raw.type === 'message' &&
    typeof raw.sessionId === 'string' &&
    typeof raw.messageId === 'string'
  ) {
    source = {
      type: 'message',
      sessionId: raw.sessionId,
      messageId: raw.messageId
    }
  } else {
    return null
  }
  if (
    !Number.isSafeInteger(value.index) ||
    typeof value.index !== 'number' ||
    value.index < 0
  )
    return null
  const scroll = isRecord(value.scroll) ? value.scroll : {}
  return {
    id: value.id,
    kind: value.kind,
    source,
    title: value.title,
    index: value.index,
    fingerprint: value.fingerprint,
    scroll: {
      x: isFiniteNumber(scroll.x) ? Math.max(0, scroll.x) : 0,
      y: isFiniteNumber(scroll.y) ? Math.max(0, scroll.y) : 0
    },
    scale: isFiniteNumber(value.scale)
      ? Math.max(PREVIEW_MIN_SCALE, Math.min(PREVIEW_MAX_SCALE, value.scale))
      : 1
  }
}
export function findDiagram(
  sources: string[],
  index: number,
  fingerprint: string
): number {
  if (
    sources[index] !== undefined &&
    previewFingerprint(sources[index]) === fingerprint
  )
    return index
  const matching = sources
    .map((source, position) => ({
      position,
      fingerprint: previewFingerprint(source)
    }))
    .filter(item => item.fingerprint === fingerprint)
  matching.sort(
    (a, b) => Math.abs(a.position - index) - Math.abs(b.position - index)
  )
  return matching[0]?.position ?? (sources[index] !== undefined ? index : -1)
}
