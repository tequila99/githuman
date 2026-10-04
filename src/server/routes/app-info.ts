import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { getAppVersion } from '../app-version.ts'
import { AppInfoSchema } from '../../shared/app/schemas.ts'

export async function appInfoRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<TypeBoxTypeProvider>().get(
    '/api/app-info',
    {
      schema: {
        tags: ['app'],
        summary: 'Server version',
        response: { 200: AppInfoSchema }
      }
    },
    async () => {
      return { version: getAppVersion() }
    }
  )
}
