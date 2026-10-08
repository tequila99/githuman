interface HeightEntry {
  version: string
  px: number
}

// Stable keys replace their previous version, so live owners do not retain edit history.
const heights = new WeakMap<object, Map<string, HeightEntry>>()

export function segmentHeight(
  owner: object,
  slot: string,
  version: string
): number | undefined {
  const entry = heights.get(owner)?.get(slot)
  return entry && entry.version === version ? entry.px : undefined
}

export function rememberSegmentHeight(
  owner: object,
  slot: string,
  version: string,
  px: number
) {
  let bySlot = heights.get(owner)
  if (!bySlot) {
    bySlot = new Map()
    heights.set(owner, bySlot)
  }
  bySlot.set(slot, { version, px })
}
