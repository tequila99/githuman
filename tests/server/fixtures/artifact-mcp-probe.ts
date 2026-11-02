import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

// This fixture checks transport only and must never open the artifact database.
const documents = new Map<string, string>()
const server = new Server(
  { name: 'githuman-artifact-probe', version: '1.0.0' },
  { capabilities: { tools: {} } }
)
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'probe_create',
      description: 'Store temporary probe text in memory.',
      inputSchema: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body'],
        additionalProperties: false
      }
    },
    {
      name: 'probe_get',
      description: 'Read temporary probe text from memory.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false
      }
    }
  ]
}))
server.setRequestHandler(CallToolRequestSchema, request => {
  const args = request.params.arguments
  if (
    request.params.name === 'probe_create' &&
    typeof args?.body === 'string'
  ) {
    const id = String(documents.size + 1)
    documents.set(id, args.body)
    return { content: [{ type: 'text', text: id }] }
  }
  if (request.params.name === 'probe_get' && typeof args?.id === 'string') {
    const text = documents.get(args.id)
    if (text !== undefined) return { content: [{ type: 'text', text }] }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'Invalid probe request.' }]
  }
})
await server.connect(new StdioServerTransport())
