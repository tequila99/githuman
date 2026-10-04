import { Type } from '@sinclair/typebox'

export const EventStreamSchema = Type.String({
  description:
    'Server-sent events. The first event is connected with ServerHello data. Then events named by SERVER_EVENT_TYPES follow with { reviewId } data.'
})
