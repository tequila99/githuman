import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Value } from '@sinclair/typebox/value'
import { ArtifactSchema } from '../src/shared/artifacts/schemas.ts'
import type { Artifact } from '../src/shared/artifacts/types.ts'
import { isRecord } from '../src/shared/utils/guards.ts'
import {
  ARTIFACT_AGENT_KEY_ENV,
  ARTIFACT_AGENT_URL_ENV
} from '../src/shared/artifacts/mcp-constants.ts'

export async function migrateArtifactSourcePaths(
  client: Client,
  manifest: unknown,
  apply = false
) {
  assert.ok(
    isRecord(manifest) && Array.isArray(manifest.documents),
    'Invalid manifest'
  )
  const pending: { artifact: Artifact; title: string; sourcePath: string }[] =
    []
  const ids = new Set<string>()
  let skipped = 0
  for (const document of manifest.documents) {
    assert.ok(
      isRecord(document) &&
        typeof document.path === 'string' &&
        document.path.length > 0
    )
    const original = document.artifact
    assert.ok(
      isRecord(original) &&
        typeof original.id === 'string' &&
        typeof original.title === 'string'
    )
    assert.ok(!ids.has(original.id), 'Duplicate artifact in manifest')
    ids.add(original.id)
    const suffix = ` [${document.path}]`
    assert.ok(
      original.title.endsWith(suffix),
      `Missing source suffix: ${original.id}`
    )
    const title = original.title.slice(0, -suffix.length)
    assert.ok(title.trim(), 'Empty clean title')
    const result = await client.callTool({
      name: 'artifacts_get',
      arguments: { id: original.id }
    })
    assert.notEqual(result.isError, true, JSON.stringify(result.content))
    assert.ok(
      Value.Check(ArtifactSchema, result.structuredContent),
      'Invalid artifact response'
    )
    const artifact = result.structuredContent
    assert.equal(
      artifact.storeId,
      original.storeId,
      `Wrong store: ${original.id}`
    )
    assert.equal(artifact.id, original.id)
    assert.equal(
      artifact.sha256,
      original.sha256,
      `Changed original: ${original.id}`
    )
    if (artifact.title === title && artifact.sourcePath === document.path) {
      skipped++
      continue
    }
    assert.equal(
      artifact.title,
      original.title,
      `Title edited since import: ${original.id}`
    )
    assert.ok(
      artifact.sourcePath === undefined ||
        artifact.sourcePath === document.path,
      `Conflicting source: ${original.id}`
    )
    pending.push({ artifact, title, sourcePath: document.path })
  }
  // Validate the whole manifest before the first write; versions guard changes after this preflight.
  if (apply) {
    for (const { artifact, title, sourcePath } of pending) {
      const result = await client.callTool({
        name: 'artifacts_update_metadata',
        arguments: {
          id: artifact.id,
          requestId: randomUUID(),
          expectedVersion: artifact.metadataVersion,
          metadata: { title, tags: artifact.tags, sourcePath }
        }
      })
      assert.notEqual(result.isError, true, JSON.stringify(result.content))
      assert.ok(
        Value.Check(ArtifactSchema, result.structuredContent),
        'Invalid artifact response'
      )
      const updated = result.structuredContent
      assert.equal(updated.title, title)
      assert.equal(updated.sourcePath, sourcePath)
      assert.equal(updated.sha256, artifact.sha256)
      assert.equal(updated.id, artifact.id)
      assert.equal(updated.metadataVersion, artifact.metadataVersion + 1)
    }
  }
  return {
    total: ids.size,
    pending: pending.length,
    skipped,
    applied: apply ? pending.length : 0
  }
}

// Run with the environment of an authorized GitHuman MCP session. The default is a dry run.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifestPath = process.argv[2]
  assert.ok(
    manifestPath,
    'Usage: node scripts/migrate-artifact-source-paths.ts <manifest.json> [--apply]'
  )
  assert.ok(
    process.argv.slice(3).every(arg => arg === '--apply'),
    'Unknown argument'
  )
  const endpoint = process.env[ARTIFACT_AGENT_URL_ENV]
  const key = process.env[ARTIFACT_AGENT_KEY_ENV]
  assert.ok(endpoint && key, 'Run within an authorized GitHuman MCP session')
  const client = new Client({
    name: 'artifact-source-path-migration',
    version: '1.0.0'
  })
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL('../src/cli/index.ts', import.meta.url)),
          'mcp',
          '--stdio'
        ],
        env: {
          [ARTIFACT_AGENT_URL_ENV]: endpoint,
          [ARTIFACT_AGENT_KEY_ENV]: key
        },
        stderr: 'inherit'
      })
    )
    console.log(
      await migrateArtifactSourcePaths(
        client,
        JSON.parse(readFileSync(manifestPath, 'utf8')),
        process.argv.includes('--apply')
      )
    )
  } finally {
    await client.close()
  }
}
