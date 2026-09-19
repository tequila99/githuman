import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import fastifyStatic from '@fastify/static'
// @fastify/sse's published types declare an ESM default export that doesn't match
// its actual CJS runtime shape, so the default import resolves to the whole module
// namespace under NodeNext — cast it back to the plugin function type.
import fastifySseImport from '@fastify/sse'
import { healthRoutes } from './routes/health.ts'
import { appInfoRoutes } from './routes/app-info.ts'
import { diffRoutes } from './routes/diff.ts'
import { gitRoutes } from './routes/git.ts'
import { reviewRoutes } from './routes/reviews.ts'
import { commentRoutes } from './routes/comments.ts'
import { exportRoutes } from './routes/export.ts'
import { eventRoutes } from './routes/events.ts'
import { createTestDatabase } from './db/index.ts'
import { createEventBus, type EventBus } from './event-bus.ts'
import { watchRepository } from './services/file-watcher.service.ts'
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documented workaround above
const fastifySse = fastifySseImport as unknown as FastifyPluginAsync

export interface BuildAppOptions {
  /** Directory containing the built SPA (index.html + assets). Omit if no SPA should be served (e.g. some tests). */
  staticRoot?: string
  /** Git repository this server instance operates on. Defaults to process.cwd(). */
  repositoryPath?: string
  /** Database for reviews/comments. Defaults to a throwaway in-memory database — production callers (server-runtime) must pass a real file-backed one. */
  db?: DatabaseSync
  /** Bus used to notify SSE clients of review/comment changes. Defaults to a fresh, process-local bus. */
  eventBus?: EventBus
  /** Watches the repository's working tree and publishes 'files:changed' SSE events on change. Off by default — the real server enables it; tests don't need it and it would otherwise watch process.cwd() by default. */
  watchFiles?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: true })
  const repositoryPath = options.repositoryPath ?? process.cwd()
  const db = options.db ?? createTestDatabase()
  const eventBus = options.eventBus ?? createEventBus()

  app.register(fastifySse)
  app.register(healthRoutes)
  app.register(appInfoRoutes)
  app.register(diffRoutes, { repositoryPath })
  app.register(gitRoutes, { repositoryPath })
  app.register(reviewRoutes, { repositoryPath, db, eventBus })
  app.register(commentRoutes, { db, eventBus })
  app.register(exportRoutes, { db })
  app.register(eventRoutes, { eventBus })

  if (options.watchFiles) {
    const watcher = watchRepository(repositoryPath, () => {
      eventBus.publish({ type: 'files:changed' })
    })
    app.addHook('onClose', async () => {
      watcher.close()
    })
  }

  if (options.staticRoot) {
    const staticRoot = options.staticRoot

    app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false
    })

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({
          error: 'Not Found',
          message: `Route ${request.url} not found`,
          statusCode: 404
        })
        return
      }

      const indexHtml = readFileSync(join(staticRoot, 'index.html'), 'utf-8')
      reply.code(200).type('text/html').send(indexHtml)
    })
  }

  return app
}
