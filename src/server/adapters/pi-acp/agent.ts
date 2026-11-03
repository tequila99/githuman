import { errorMessage } from '../../../shared/utils/error-message.ts'
import * as acp from '@agentclientprotocol/sdk'
import { PiSession } from './session.ts'
import type { PiProfile } from './compatibility.ts'

export function createPiAgent(profile: PiProfile) {
  let session: PiSession | undefined
  let used = false
  let connection: acp.AgentConnection
  const app = acp
    .agent({ name: 'githuman-pi' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: false, sse: false },
        loadSession: false
      }
    }))
    .onRequest(acp.methods.agent.session.new, async ctx => {
      if (used) {
        throw new acp.RequestError(
          -32602,
          'One pi bridge process supports exactly one session/new'
        )
      }
      used = true
      session = new PiSession(profile, {
        update: (sessionId, update) =>
          ctx.client.notify(acp.methods.client.session.update, {
            sessionId,
            update
          }),
        permission: (request, signal) =>
          ctx.client.request(
            acp.methods.client.session.requestPermission,
            request,
            { cancellationSignal: signal }
          ),
        failure: () =>
          connection?.close(new Error('Pi bridge runtime or MCP failed'))
      })
      try {
        await session.start(ctx.params.cwd, ctx.params.mcpServers)
      } catch (error) {
        throw new acp.RequestError(-32000, errorMessage(error), {
          githumanBridge: { version: 1, profile, phase: 'startup' }
        })
      }
      return {
        sessionId: session.id,
        configOptions: session.config,
        _meta: {
          githumanBridge: { version: 1, profile, registryGeneration: 1 }
        }
      }
    })
    .onRequest(acp.methods.agent.session.prompt, async ctx => {
      if (!session) {
        throw new acp.RequestError(-32602, 'Pi session has not been created')
      }
      session.assertSession(ctx.params.sessionId)
      try {
        return await session.prompt(ctx.params.prompt)
      } catch (error) {
        throw new acp.RequestError(-32000, errorMessage(error), {
          githumanBridge: { version: 1, profile, phase: 'prompt' }
        })
      }
    })
    .onNotification(acp.methods.agent.session.cancel, async ctx => {
      if (!session) {
        throw new acp.RequestError(-32602, 'Pi session has not been created')
      }
      session.assertSession(ctx.params.sessionId)
      await session.cancel()
    })
    .onRequest(acp.methods.agent.session.setMode, async ctx => {
      if (!session) {
        throw new acp.RequestError(-32602, 'Pi session has not been created')
      }
      session.assertSession(ctx.params.sessionId)
      await session.setConfig('thought_level', ctx.params.modeId)
      return {}
    })
    .onRequest(acp.methods.agent.session.setConfigOption, async ctx => {
      if (!session) {
        throw new acp.RequestError(-32602, 'Pi session has not been created')
      }
      session.assertSession(ctx.params.sessionId)
      if (typeof ctx.params.value !== 'string') {
        throw new acp.RequestError(-32602, 'Invalid pi setting')
      }
      await session.setConfig(ctx.params.configId, ctx.params.value)
      return { configOptions: session.config }
    })
  return {
    connect(stream: acp.Stream) {
      connection = app.connect(stream)
      void connection.closed.then(() => session?.close())
      return connection
    },
    close() {
      session?.close()
      connection?.close()
    }
  }
}
