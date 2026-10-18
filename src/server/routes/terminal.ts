import type { WebsocketPluginOptions } from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { TerminalTokenSchema } from '../../shared/terminal/schemas.ts'
import { TERMINAL_FRAME_BYTES } from '../../shared/terminal/constants.ts'
import { ForbiddenError } from '../errors/http.ts'
import { requireTerminalOrigin } from '../hooks/terminal/local-origin.ts'
import { TerminalRegistry } from '../services/terminal/registry.ts'
import { TerminalTokens } from '../services/terminal/tokens.ts'
import { attachTerminalSocket } from '../services/terminal/socket.ts'
import type { DeviceConnections } from '../services/device-connections.ts'

// Reject oversized values early. A real token has 43 characters.
const MAX_TOKEN_LENGTH = 64
// Leave room for the JSON envelope around an input frame.
const MAX_PAYLOAD_BYTES = TERMINAL_FRAME_BYTES * 2

// Apply the same frame limit to every terminal upgrade.
export const TERMINAL_WEBSOCKET_OPTIONS: WebsocketPluginOptions = {
  options: { maxPayload: MAX_PAYLOAD_BYTES }
}

export async function terminalRoutes(
  app: FastifyInstance,
  options: {
    registry: TerminalRegistry
    /** Revoke and expiry close the sockets of a device (ADR 0079). */
    deviceConnections: DeviceConnections
  }
): Promise<void> {
  const tokens = new TerminalTokens()
  const connections = new Set<{ close: () => void }>()
  app.addHook('onError', async (_request, _reply, error) => {
    // Request URLs contain credentials, so log only the rejection code.
    app.log.warn({ code: error.code }, 'Terminal request rejected')
  })
  const api = app.withTypeProvider<TypeBoxTypeProvider>()
  api.post(
    '/api/terminal/token',
    {
      onRequest: requireTerminalOrigin,
      schema: {
        tags: ['terminal'],
        summary: 'Issue a terminal connection token',
        response: { 200: TerminalTokenSchema }
      }
    },
    async request => ({ token: tokens.issue(request.headers.origin ?? '') })
  )
  api.get(
    '/api/terminal/ws',
    {
      websocket: true,
      schema: {
        hide: true,
        querystring: Type.Object(
          {
            token: Type.String({
              maxLength: MAX_TOKEN_LENGTH,
              description: 'One-use connection credential.'
            })
          },
          {
            additionalProperties: false,
            description: 'Terminal upgrade credential.'
          }
        )
      },
      onRequest: requireTerminalOrigin,
      preValidation: async request => {
        if (
          !tokens.consume(request.query.token, request.headers.origin ?? '')
        ) {
          throw new ForbiddenError(
            'Terminal connection token is invalid or expired.'
          )
        }
      }
    },
    (socket, request) => {
      // No `await` between this check of the device and the attach.
      const release = options.deviceConnections.track(request, () =>
        socket.terminate()
      )
      if (!release) {
        return
      }
      const connection = attachTerminalSocket(socket, options.registry, {
        onDisconnect: () => {
          connections.delete(connection)
          release()
        }
      })
      connections.add(connection)
    }
  )
  app.addHook('onClose', async () => {
    for (const connection of connections) connection.close()
    tokens.clear()
    await options.registry.dispose()
  })
}
