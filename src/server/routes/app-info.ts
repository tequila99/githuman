import type { FastifyInstance } from 'fastify'
import { getAppVersion } from '../app-version.ts'

export async function appInfoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/app-info', async () => {
    return { version: getAppVersion() }
  })
}
