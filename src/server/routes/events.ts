import type { FastifyInstance } from 'fastify'
import type { EventBus } from '../event-bus.ts'
import type { ServerHello } from '../../shared/types.ts'

export interface EventRoutesOptions {
  eventBus: EventBus
  /** Identifies this server process to clients — see ServerHello. */
  instanceId: string
}

export async function eventRoutes(
  app: FastifyInstance,
  opts: EventRoutesOptions
): Promise<void> {
  const { eventBus, instanceId } = opts
  const hello: ServerHello = { instanceId }

  app.get('/api/events', { sse: true }, async (request, reply) => {
    reply.sse.keepAlive()
    await reply.sse.send({ event: 'connected', data: hello })

    const unsubscribe = eventBus.subscribe(event => {
      void reply.sse.send({
        event: event.type,
        data: { reviewId: event.reviewId }
      })
    })

    reply.sse.onClose(() => {
      unsubscribe()
    })
  })
}
