import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { buildApp, type BuildAppOptions } from '../../../src/server/app.ts'

interface Operation {
  parameters?: { name: string; description?: string }[]
  requestBody?: unknown
  responses: Record<string, { description?: string; content?: unknown }>
}

/** Builds the app and records each route that the spec must show. */
async function setup(t: TestContext, options: BuildAppOptions = {}) {
  const routes: { method: string; url: string }[] = []
  const app: FastifyInstance = buildApp(options)
  app.addHook('onRoute', route => {
    const methods = [route.method].flat()
    const hidden = route.schema?.hide
    for (const method of methods) {
      if (method !== 'HEAD' && !hidden) routes.push({ method, url: route.url })
    }
  })
  t.after(() => app.close())
  await app.ready()
  const response = await app.inject('/api/openapi.json')
  assert.equal(response.statusCode, 200)
  const spec = response.json<{
    openapi: string
    info: { version: string }
    paths: Record<string, Record<string, Operation>>
  }>()
  return { app, routes, spec }
}

/** `/api/x/:id` → `/api/x/{id}`, `/api/x/*` → `/api/x/{*}` as @fastify/swagger writes them. */
function specPath(url: string): string {
  return url.replace(/:(\w+)/g, '{$1}').replace(/\*$/, '{*}')
}

/** Paths in `schema` to object properties that have no description. */
function undescribed(schema: unknown, at: string): string[] {
  if (typeof schema !== 'object' || schema === null) return []
  const missing: string[] = []
  const node = schema as Record<string, unknown>
  const properties = node.properties as Record<string, unknown> | undefined
  for (const [name, property] of Object.entries(properties ?? {})) {
    const described = (property as { description?: unknown }).description
    if (typeof described !== 'string' || described.length === 0) {
      missing.push(`${at}.${name}`)
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        missing.push(...undescribed(item, `${at}.${key}[${index}]`))
      )
    } else {
      missing.push(...undescribed(value, `${at}.${key}`))
    }
  }
  return missing
}

test('the spec is OpenAPI 3.1 and shows every route', async t => {
  const { routes, spec } = await setup(t, { agentPresets: [] })
  assert.equal(spec.openapi, '3.1.0')
  assert.match(spec.info.version, /^\d+\.\d+\.\d+/)
  assert.ok(routes.length > 25)
  for (const { method, url } of routes) {
    assert.ok(
      spec.paths[specPath(url)]?.[method.toLowerCase()],
      `${method} ${url} is in the spec`
    )
  }
})

test('every operation has a success answer and described fields', async t => {
  const { spec } = await setup(t, { agentPresets: [] })
  const missing: string[] = []
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const name = `${method.toUpperCase()} ${path}`
      const success = Object.keys(operation.responses).filter(code =>
        code.startsWith('2')
      )
      assert.ok(success.length > 0, `${name} has a 2xx answer`)
      for (const [code, answer] of Object.entries(operation.responses)) {
        assert.ok(answer.description, `${name} ${code} has a description`)
      }
      for (const parameter of operation.parameters ?? []) {
        if (!parameter.description) {
          missing.push(`${name} parameter ${parameter.name}`)
        }
      }
      missing.push(...undescribed(operation.requestBody, `${name} body`))
      missing.push(...undescribed(operation.responses, `${name} responses`))
    }
  }
  assert.deepEqual(missing, [])
})

test('agent routes are in the spec only when the server has them', async t => {
  const without = await setup(t)
  assert.deepEqual(
    Object.keys(without.spec.paths).filter(path =>
      path.startsWith('/api/agent')
    ),
    []
  )

  const { spec } = await setup(t, { agentPresets: [] })
  const agentPaths = Object.keys(spec.paths).filter(path =>
    path.startsWith('/api/agent')
  )
  assert.ok(agentPaths.length > 0)
  for (const path of agentPaths) {
    for (const operation of Object.values(spec.paths[path] ?? {})) {
      assert.ok(operation.responses['403'], `${path} documents the 403`)
    }
  }
})

test('Swagger UI is served only with apiDocs; the spec always', async t => {
  const off = await setup(t)
  assert.equal((await off.app.inject('/api/docs')).statusCode, 404)
  assert.equal((await off.app.inject('/api/openapi.json')).statusCode, 200)

  const on = await setup(t, { apiDocs: true })
  const docs = await on.app.inject('/api/docs/')
  assert.equal(docs.statusCode, 200)
  assert.match(docs.headers['content-type'] ?? '', /text\/html/)
})
