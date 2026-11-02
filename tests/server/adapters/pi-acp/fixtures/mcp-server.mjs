import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'

createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (!('id' in request)) return
  let result = {}
  if (request.method === 'initialize') {
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'pi-integration-fixture', version: '1' },
      instructions: 'GITHUMAN_FIXTURE_INSTRUCTIONS_BEFORE_FIRST_PROMPT'
    }
  }
  if (request.method === 'tools/list') {
    result = {
      tools: [
        {
          name: 'probe',
          description: 'Read the fixture probe',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'integer' } },
            required: ['value'],
            additionalProperties: false
          }
        }
      ]
    }
  }
  if (request.method === 'tools/call') {
    appendFileSync(
      process.env.FIXTURE_CALL_LOG,
      JSON.stringify(request.params) + '\n'
    )
    result = {
      content: [{ type: 'text', text: 'probe complete' }],
      structuredContent: { ok: true }
    }
  }
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n'
  )
})
process.stdin.on('end', () => process.exit(0))
