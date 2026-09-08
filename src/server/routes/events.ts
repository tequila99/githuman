import type { FastifyInstance } from 'fastify'
import type { EventBus } from '../event-bus.ts'

export interface EventRoutesOptions {
  eventBus: EventBus
}

export async function eventRoutes(
  app: FastifyInstance,
  opts: EventRoutesOptions
): Promise<void> {
  const { eventBus } = opts

  app.get('/api/events', { sse: true }, async (request, reply) => {
    reply.sse.keepAlive()
    await reply.sse.send({ event: 'connected', data: {} })

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
