import { isRecord } from './guards.ts'
// Object property order does not change the identity of a JSON command.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const object = value
    return `{${Object.keys(object)
      .filter(key => object[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Only finite numbers can be canonicalized.')
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Only JSON values can be canonicalized.')
  }
  return serialized
}
