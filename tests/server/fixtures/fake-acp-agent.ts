// A minimal ACP agent over stdio for tests. Behaviour is chosen by the prompt text:
//   "edit"   → tool call with a diff, asks permission, completes or fails by the answer
//   "slow"   → streams chunks until cancelled
//   "crash"  → exits abruptly mid-turn
//   "reconfig" → the agent adds a "turbo" setting on its own (config_option_update)
//   "askfail" → asks permission, then fails the turn without waiting for the answer
//   "echo:*" → anything else replies with the concatenated text of all prompt blocks
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const embeddedContext = process.env.FAKE_EMBEDDED !== '0'
const image = process.env.FAKE_IMAGE !== '0'
const cancelled = new Set<string>()

// Session settings (ACP configOptions): a grouped select and a boolean.
const settings = { model: 'm1', fast: false, mode: 'agent' }
const withMode = process.env.FAKE_MODE === '1'
let withTurbo = false
function configOptions(): acp.SessionConfigOption[] {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: settings.model,
      options: [
        {
          group: 'g1',
          name: 'Group one',
          options: [
            { value: 'm1', name: 'Model 1' },
            { value: 'm2', name: 'Model 2', description: 'second' }
          ]
        },
        {
          group: 'g2',
          name: 'Group two',
          options: [{ value: 'm3', name: 'Model 3' }]
        }
      ]
    },
    {
      id: 'fast',
      name: 'Fast',
      type: 'boolean',
      currentValue: settings.fast
    },
    ...(withTurbo
      ? [
          {
            id: 'turbo',
            name: 'Turbo',
            type: 'boolean' as const,
            currentValue: false
          }
        ]
      : []),
    ...(withMode
      ? [
          {
            id: 'mode',
            name: 'Mode',
            category: 'mode',
            type: 'select' as const,
            currentValue: settings.mode,
            options: ['agent', 'plan', 'ask'].map(value => ({
              value,
              name: value.charAt(0).toUpperCase() + value.slice(1)
            }))
          }
        ]
      : [])
  ]
}

// `ctx.request(...)` of the agent side reaches the client; see the SDK's agent example.
const app = acp
  .agent({ name: 'fake-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { promptCapabilities: { embeddedContext, image } }
  }))
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: 'fake-session',
    configOptions: configOptions()
  }))
  .onRequest(acp.methods.agent.session.setConfigOption, ctx => {
    if (ctx.params.configId === 'fail') {
      throw new acp.RequestError(-32602, 'agent refused')
    }
    if (ctx.params.configId === 'model') {
      settings.model = String(ctx.params.value)
    } else if (ctx.params.configId === 'mode') {
      settings.mode = String(ctx.params.value)
    } else if (ctx.params.configId === 'fast') {
      settings.fast = ctx.params.value === true
    }
    return { configOptions: configOptions() }
  })
  .onNotification(acp.methods.agent.session.cancel, ctx => {
    cancelled.add(ctx.params.sessionId)
  })
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const { sessionId, prompt } = ctx.params
    const text = prompt
      .map(block =>
        block.type === 'text'
          ? block.text
          : block.type === 'resource' && 'text' in block.resource
            ? block.resource.text
            : block.type === 'resource'
              ? `blob:${block.resource.uri}`
              : block.type === 'resource_link'
                ? `link:${block.uri}`
                : block.type === 'image'
                  ? `image:${block.mimeType}:${block.data}`
                  : ''
      )
      .join('\n')
    const say = (t: string) =>
      ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: t }
        }
      })

    if (text.startsWith('crash')) {
      await say('about to crash')
      process.exit(3)
    }
    if (text.startsWith('reconfig')) {
      withTurbo = true
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'config_option_update',
          configOptions: configOptions()
        }
      })
      return { stopReason: 'end_turn' }
    }
    if (text.startsWith('slow')) {
      for (let i = 0; i < 200 && !cancelled.has(sessionId); i++) {
        await say(`tick ${i} `)
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      return {
        stopReason: cancelled.delete(sessionId) ? 'cancelled' : 'end_turn'
      }
    }
    if (text.startsWith('askfail')) {
      void ctx.client
        .request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: 't2', title: 'Run it' },
          options: [{ optionId: 'allow', name: 'Yes', kind: 'allow_once' }]
        })
        .catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 50))
      throw new acp.RequestError(-32603, 'boom')
    }
    if (text.startsWith('edit')) {
      const toolCall = {
        toolCallId: 't1',
        title: 'Write a.txt',
        kind: 'edit' as const,
        status: 'pending' as const,
        locations: [{ path: '/repo/a.txt' }],
        content: [
          {
            type: 'diff' as const,
            path: '/repo/a.txt',
            oldText: null,
            newText: 'hi'
          }
        ]
      }
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call', ...toolCall }
      })
      const answer = await ctx.client.request<acp.RequestPermissionResponse>(
        acp.methods.client.session.requestPermission,
        {
          sessionId,
          toolCall,
          options: [
            { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
            { optionId: 'reject', name: 'No', kind: 'reject_once' }
          ]
        }
      )
      const allowed =
        answer.outcome.outcome === 'selected' &&
        answer.outcome.optionId === 'allow'
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: allowed ? 'completed' : 'failed'
        }
      })
      await say(allowed ? 'edited' : 'blocked')
      return { stopReason: 'end_turn' }
    }
    if (text.startsWith('settings')) {
      await say(`model:${settings.model} fast:${settings.fast}`)
      return { stopReason: 'end_turn' }
    }
    if (text.startsWith('pid')) {
      await say(`pid:${process.pid}`)
      return { stopReason: 'end_turn' }
    }
    await say(`echo:${text}`)
    return { stopReason: 'end_turn' }
  })

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same stream, differing lib typings
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
)
await app.connect(stream).closed
