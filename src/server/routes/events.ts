import type { FastifyInstance } from 'fastify'
import type { EventBus } from '../event-bus.ts'
import { safeSend } from '../utils/sse.ts'
import type { ServerHello } from '../../shared/events/types.ts'
import { EventStreamSchema } from '../../shared/events/schemas.ts'
import type { DeviceConnections } from '../services/device-connections.ts'

export interface EventRoutesOptions {
  eventBus: EventBus
  /** Identifies this server process to clients — see ServerHello. */
  instanceId: string
  /** Revoke and expiry close the streams of a device (ADR 0079). */
  connections: DeviceConnections
}

export async function eventRoutes(
  app: FastifyInstance,
  opts: EventRoutesOptions
): Promise<void> {
  const { eventBus, instanceId, connections } = opts
  const hello: ServerHello = { instanceId }

  app.get(
    '/api/events',
    {
      sse: true,
      schema: {
        tags: ['events'],
        summary: 'Stream of review, comment and file changes',
        response: {
          200: {
            description: 'An SSE stream that stays open.',
            content: { 'text/event-stream': { schema: EventStreamSchema } }
          }
        }
      }
    },
    async (request, reply) => {
      reply.sse.keepAlive()
      await reply.sse.send({ event: 'connected', data: hello })
      // The client can leave during the await; a later `onClose` would never run.
      if (!reply.sse.isConnected) {
        return
      }
      // No `await` between this check of the device and the subscription.
      const release = connections.track(request, () => reply.sse.close())
      if (!release) {
        return
      }

      const unsubscribe = eventBus.subscribe(event => {
        safeSend(reply.sse, {
          event: event.type,
          data: { reviewId: event.reviewId }
        })
      })

      reply.sse.onClose(() => {
        unsubscribe()
        release()
      })
    }
  )
}
