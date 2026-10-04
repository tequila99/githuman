import { Type, type TSchema } from '@sinclair/typebox'

/**
 * A nullable value for a response schema. Request schemas put `Type.Null()`
 * first instead, because Fastify's Ajv coerces null into the first type.
 */
export function Nullable<T extends TSchema>(schema: T) {
  const { description } = schema
  return Type.Union(
    [schema, Type.Null()],
    typeof description === 'string' ? { description } : {}
  )
}
