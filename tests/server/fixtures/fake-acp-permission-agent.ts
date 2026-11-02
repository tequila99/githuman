import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

// The prompt supplies raw ACP requests so tests can exercise partial tool updates.
const agent = acp
  .agent({ name: 'permission-probe' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {}
  }))
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: 'permission-probe'
  }))
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const text = ctx.params.prompt.find(block => block.type === 'text')
    if (!text || text.type !== 'text') throw new Error('Missing test input')
    const input: {
      updates?: acp.SessionUpdate[]
      requests: acp.RequestPermissionRequest[]
    } = JSON.parse(text.text)
    for (const update of input.updates ?? []) {
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update
      })
    }
    for (const request of input.requests) {
      const response = await ctx.client.request<acp.RequestPermissionResponse>(
        acp.methods.client.session.requestPermission,
        { ...request, sessionId: ctx.params.sessionId }
      )
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: JSON.stringify(response) }
        }
      })
    }
    return { stopReason: 'end_turn' as const }
  })
agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams have equivalent runtime contracts.
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
)
