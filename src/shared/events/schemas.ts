import { Type } from '@sinclair/typebox'

export const EventStreamSchema = Type.String({
  description:
    'Server-sent events. The first event is connected with { instanceId } data. Then come review:created, review:updated, review:deleted, comment:created, comment:updated and comment:deleted with { reviewId } data, files:changed with {} data, and artifacts:changed with { storeId, storeEpoch } data.'
})
