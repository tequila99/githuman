import { NotFoundError } from './errors/http.ts'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import {
  terminalRoutes,
  TERMINAL_WEBSOCKET_OPTIONS
} from './routes/terminal.ts'
import { TerminalRegistry } from './services/terminal/registry.ts'
import { loadPty, terminalSupported } from './services/terminal/backend.ts'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
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
import { agentRoutes } from './routes/agent.ts'
import { openApiRoutes } from './routes/openapi.ts'
import { openApiOptions } from './config/openapi.ts'
import { createSessionRegistry } from './services/agent/session-registry.ts'
import type { AgentPreset } from '../shared/agents/types.ts'
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
  /** Lets open pages detect a server restart (see ServerHello). Random by default. */
  instanceId?: string
  /**
   * Enables the agent chat routes (ADR 0023) with these launch presets. Off by
   * default: the routes are a remote-execution surface, so the CLI passes this
   * only for a loopback bind. Tests pass a fake-agent preset.
   */
  agentPresets?: readonly AgentPreset[]
  /**
   * Serves Swagger UI at `/api/docs`. Off by default: `dev:server` and the
   * `--api-docs` flag turn it on. `/api/openapi.json` is always served.
   */
  apiDocs?: boolean
  terminalEnabled?: boolean
  terminalRegistry?: TerminalRegistry
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: true })
  const repositoryPath = options.repositoryPath ?? process.cwd()
  const db = options.db ?? createTestDatabase()
  const eventBus = options.eventBus ?? createEventBus()

  // Windows includes a PTY binary, but the shell and process list are Unix-only.
  const terminalEnabled =
    options.terminalEnabled === true && terminalSupported()

  if (terminalEnabled)
    app.register(fastifyWebsocket, TERMINAL_WEBSOCKET_OPTIONS)
  app.register(fastifySse)
  // The spec collects routes as they are added, so it comes before them.
  app.register(fastifySwagger, openApiOptions())
  if (options.apiDocs) {
    app.register(fastifySwaggerUi, { routePrefix: '/api/docs' })
  }
  app.register(openApiRoutes)
  app.register(healthRoutes)
  app.register(appInfoRoutes, {
    terminalCapability: async () => ({
      available: terminalEnabled,
      mode: terminalEnabled ? ((await loadPty()) ? 'pty' : 'pipe') : null
    })
  })
  app.register(diffRoutes, { repositoryPath })
  app.register(gitRoutes, { repositoryPath })
  app.register(reviewRoutes, { repositoryPath, db, eventBus })
  app.register(commentRoutes, { db, eventBus })
  app.register(exportRoutes, { db, repositoryPath })
  app.register(eventRoutes, {
    eventBus,
    instanceId: options.instanceId ?? randomUUID()
  })

  if (terminalEnabled)
    app.register(terminalRoutes, {
      registry:
        options.terminalRegistry ??
        new TerminalRegistry({
          repositoryPath,
          onLifecycle: event =>
            app.log.info({ terminal: event }, 'Terminal lifecycle')
        })
    })

  if (options.agentPresets) {
    app.register(agentRoutes, {
      registry: createSessionRegistry({
        presets: options.agentPresets,
        repositoryPath
      }),
      db,
      repositoryPath,
      eventBus
    })
  }

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
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !options.staticRoot) {
      throw new NotFoundError(`Route ${request.url} not found`)
    }

    const indexHtml = readFileSync(
      join(options.staticRoot, 'index.html'),
      'utf-8'
    )
    reply.code(200).type('text/html').send(indexHtml)
  })

  return app
}
