import { isRecord } from '../../../../../src/shared/utils/guards.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join, dirname, delimiter, isAbsolute } from 'node:path'
import type { TestContext } from 'node:test'

export interface ModelToolCall {
  name: string
  arguments: Record<string, unknown>
}

export async function localModel(
  t: TestContext,
  dir: string,
  next: (body: Record<string, unknown>) => ModelToolCall | null
) {
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    try {
      for await (const chunk of req) raw += chunk
    } catch (error) {
      if (req.aborted) return
      throw error
    }
    if (req.aborted || res.destroyed) return
    const body: Record<string, unknown> = JSON.parse(raw)
    requests.push(body)
    const tool = next(body)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `fixture_${requests.length}`,
              type: 'function',
              function: {
                name: tool.name,
                arguments: JSON.stringify(tool.arguments)
              }
            }
          ]
        }
      : { role: 'assistant', content: 'done' }
    for (const [value, finish] of [
      [delta, null],
      [{}, tool ? 'tool_calls' : 'stop']
    ]) {
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`
      )
    }
    res.end('data: [DONE]\n\n')
  })
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Local model did not listen')
  }
  await writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'probe', defaultModel: 'probe' })
  )
  await writeFile(
    join(dir, 'models.json'),
    JSON.stringify({
      providers: {
        probe: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions',
          apiKey: 'fixture',
          models: [
            {
              id: 'probe',
              name: 'probe',
              reasoning: false,
              input: ['text'],
              contextWindow: 32000,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            },
            {
              id: 'probe-thinking',
              name: 'probe-thinking',
              reasoning: true,
              input: ['text'],
              contextWindow: 32000,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }
          ]
        }
      }
    })
  )
  return requests
}

export function modelToolOutput(
  body: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!Array.isArray(body.messages)) return undefined
  const messages = body.messages.filter(
    (value): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null
  )
  const value = messages
    .filter(message => message.role === 'tool')
    .at(-1)?.content
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function usePiEnvironment(
  t: TestContext,
  dir: string,
  command: string
): void {
  const keys = [
    'HOME',
    'PATH',
    'PI_CODING_AGENT_DIR',
    'PI_ACP_PI_COMMAND',
    'GITHUMAN_PI_PROFILE'
  ] as const
  const previous = keys.map(key => [key, process.env[key]] as const)
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })
  process.env.HOME = dir
  process.env.PI_CODING_AGENT_DIR = dir
  process.env.GITHUMAN_PI_PROFILE = 'chat'
  delete process.env.PI_ACP_PI_COMMAND
  if (isAbsolute(command)) {
    process.env.PATH = `${dirname(command)}${delimiter}${process.env.PATH ?? ''}`
  }
}
