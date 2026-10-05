/** True when both arrays have the same length and `same` holds for each pair of items. */
export function equalArrays<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean = Object.is
): boolean {
  return a.length === b.length && a.every((item, i) => same(item, b[i]!))
}
