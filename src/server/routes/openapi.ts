import type { FastifyInstance } from 'fastify'

export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  // No authentication (ADR 0008): the spec tells no more than the API itself.
  app.get('/api/openapi.json', { schema: { hide: true } }, async () =>
    app.swagger()
  )
}
