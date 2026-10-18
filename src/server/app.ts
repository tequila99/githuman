import { watchNotes } from './services/notes-watcher.service.ts'
import { notesRoutes } from './routes/notes.ts'
import { NotesService } from './services/notes.service.ts'
import { NotFoundError } from './errors/http.ts'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'
import fastifyStatic from '@fastify/static'
import { ajvFilePlugin } from '@fastify/multipart'
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
import fastifyCookie from '@fastify/cookie'
import fastifyPlugin from 'fastify-plugin'
import { DeviceService } from './services/device.service.ts'
import { DeviceConnections } from './services/device-connections.ts'
import { createAccessHook } from './hooks/access/require-access.ts'
import { deviceRoutes } from './routes/devices.ts'
import { AllowedHosts } from './utils/allowed-hosts.ts'
import type { Device } from '../shared/devices/types.ts'
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documented workaround above
const fastifySse = fastifySseImport as unknown as FastifyPluginAsync

// Expired records leave the database within this time (ADR 0079, item 8).
const DEVICE_SWEEP_MS = 60 * 60 * 1000
// Open connections of a device that lost access close within this time,
// also when another server process on the same database revoked it.
// One indexed SELECT per connected device.
const DEVICE_RECHECK_MS = 2000

export interface BuildAppOptions {
  /** Launch directory used for project notes; it can differ from the Git root. */
  projectPath?: string
  /** Notes storage path, resolved relative to projectPath. */
  notesDir?: string
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
   * default. The routes are a remote-execution surface: their hook accepts
   * only local requests (ADR 0079). Tests pass a fake-agent preset.
   */
  agentPresets?: readonly AgentPreset[]
  /**
   * Serves Swagger UI at `/api/docs`. Off by default: `dev:server` and the
   * `--api-docs` flag turn it on. `/api/openapi.json` is always served.
   */
  apiDocs?: boolean
  /** Exact host names that LAN requests may use besides the machine addresses (ADR 0079). */
  allowedHosts?: readonly string[]
  /** Tells the operator about a pairing request, for example in the console. */
  onPairingRequest?: (device: Device) => void
  /** Clock of the device service; tests move it. */
  now?: () => number
  terminalEnabled?: boolean
  terminalRegistry?: TerminalRegistry
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    forceCloseConnections: true,
    ajv: {
      plugins: [
        ajv => {
          ajvFilePlugin(ajv)
          return ajv
        }
      ]
    }
  })
  const repositoryPath = options.repositoryPath ?? process.cwd()
  const db = options.db ?? createTestDatabase()
  const eventBus = options.eventBus ?? createEventBus()

  const devices = new DeviceService(db, {
    ...(options.now ? { now: options.now } : {}),
    onChange: () => eventBus.publish({ type: 'devices:changed' })
  })
  const deviceConnections = new DeviceConnections(devices)
  devices.removeExpired()
  const sweep = setInterval(() => devices.removeExpired(), DEVICE_SWEEP_MS)
  sweep.unref()
  const recheck = setInterval(
    () => deviceConnections.recheck(),
    DEVICE_RECHECK_MS
  )
  recheck.unref()
  app.addHook('onClose', async () => {
    clearInterval(sweep)
    clearInterval(recheck)
  })
  // Windows includes a PTY binary, but the shell and process list are Unix-only.
  const terminalEnabled =
    options.terminalEnabled === true && terminalSupported()

  if (terminalEnabled) {
    app.register(fastifyWebsocket, TERMINAL_WEBSOCKET_OPTIONS)
  }
  app.register(fastifySse)
  app.decorateRequest('access', null)
  app.register(fastifyCookie)
  // Registered after the cookie and WebSocket plugins: the hook needs parsed
  // cookies, and a rejected upgrade before the WebSocket hook leaves the socket open.
  app.register(
    fastifyPlugin(async root => {
      root.addHook(
        'onRequest',
        createAccessHook({
          devices,
          allowedHosts: new AllowedHosts(options.allowedHosts)
        })
      )
    })
  )

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
  const projectPath = options.projectPath ?? repositoryPath
  const notes = new NotesService(
    projectPath,
    resolve(projectPath, options.notesDir ?? '.githuman/notes'),
    options.notesDir === undefined,
    eventBus,
    db
  )
  app.register(notesRoutes, { service: notes })
  app.addHook('onClose', async () => {
    await notes.identity.close()
  })
  if (options.watchFiles) {
    const watcher = watchNotes(notes, () =>
      eventBus.publish({ type: 'notes:changed' })
    )
    app.addHook('onClose', async () => {
      watcher.close()
    })
  }
  app.register(diffRoutes, { repositoryPath })
  app.register(gitRoutes, { repositoryPath })
  app.register(reviewRoutes, { repositoryPath, db, eventBus })
  app.register(commentRoutes, { db, eventBus })
  app.register(exportRoutes, { db, repositoryPath })
  app.register(deviceRoutes, {
    devices,
    ...(options.onPairingRequest
      ? { onPairingRequest: options.onPairingRequest }
      : {})
  })
  app.register(eventRoutes, {
    eventBus,
    connections: deviceConnections,
    instanceId: options.instanceId ?? randomUUID()
  })

  if (terminalEnabled) {
    app.register(terminalRoutes, {
      deviceConnections,
      registry:
        options.terminalRegistry ??
        new TerminalRegistry({
          repositoryPath,
          onLifecycle: event =>
            app.log.info({ terminal: event }, 'Terminal lifecycle')
        })
    })
  }

  if (options.agentPresets) {
    app.register(agentRoutes, {
      notes,
      registry: createSessionRegistry({
        presets: options.agentPresets,
        repositoryPath
      }),
      db,
      repositoryPath,
      eventBus,
      connections: deviceConnections
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
