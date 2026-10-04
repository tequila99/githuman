import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { HealthSchema } from '../../shared/app/schemas.ts'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<TypeBoxTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['app'],
        summary: 'Liveness check',
        response: { 200: HealthSchema }
      }
    },
    async () => {
      return { status: 'ok' as const }
    }
  )
}
