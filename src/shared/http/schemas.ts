import { Type } from '@sinclair/typebox'

/** Fields of the error body that Fastify writes for each error. */
const API_ERROR_FIELDS = {
  statusCode: Type.Integer({ description: 'HTTP status code.' }),
  code: Type.Optional(
    Type.String({
      description: 'Stable error code, for example GHT_HTTP_NOT_FOUND.'
    })
  ),
  error: Type.String({ description: 'HTTP status text.' }),
  message: Type.String({ description: 'What went wrong.' })
}

/** Error answers that every route can give. */
export const ERROR_RESPONSES = {
  '4xx': Type.Object(API_ERROR_FIELDS, {
    description: 'The request is not valid.'
  }),
  '5xx': Type.Object(API_ERROR_FIELDS, { description: 'The server failed.' })
}

export const ApiErrorSchema = Type.Object(API_ERROR_FIELDS, {
  description: 'Error body of every route.'
})

export const NoContentSchema = Type.Null({
  description: 'The request succeeded. The body is empty.'
})
