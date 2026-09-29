import type { ServerHello } from '@/api/types'

/** Anything but a well-formed ServerHello is ignored rather than trusted. */
export function parseServerHello(data: unknown): ServerHello | null {
  if (typeof data !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(data)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'instanceId' in parsed &&
      typeof parsed.instanceId === 'string'
    ) {
      return { instanceId: parsed.instanceId }
    }
  } catch {
    // Not JSON — treat like a missing payload.
  }
  return null
}
