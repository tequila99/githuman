import type { SwaggerOptions } from '@fastify/swagger'
import { getAppVersion } from '../app-version.ts'

/**
 * Options of `@fastify/swagger`. OpenAPI 3.1 because TypeBox writes null as
 * `{ type: 'null' }`, and OpenAPI 3.0 does not allow it.
 */
export function openApiOptions(): SwaggerOptions {
  return {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'githuman',
        version: getAppVersion(),
        description:
          'HTTP API of the local githuman server. The API has no authentication: the tool is local.'
      },
      tags: [
        { name: 'diff', description: 'Changes of the working tree and refs.' },
        { name: 'git', description: 'Repository facts, files and index.' },
        { name: 'reviews', description: 'Reviews and their export.' },
        { name: 'comments', description: 'Comments of reviews.' },
        { name: 'events', description: 'Server-sent change events.' },
        { name: 'app', description: 'Server version and health.' },
        {
          name: 'agent',
          description:
            'Agent chats. The server has these routes only on a loopback host, and each request needs a local Host and Origin.'
        }
      ]
    }
  }
}
