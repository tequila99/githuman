import type { ServerHello } from '@/api/types'
import { isRecord } from '@/utils/guards'

/** Anything but a well-formed ServerHello is ignored rather than trusted. */
export function parseServerHello(data: unknown): ServerHello | null {
  if (typeof data !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(data)
    if (isRecord(parsed) && typeof parsed.instanceId === 'string') {
      return { instanceId: parsed.instanceId }
    }
  } catch {
    // Not JSON — treat like a missing payload.
  }
  return null
}
