import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'

// Written by `fixture-server.ts` after it seeds the throwaway repository.
const FIXTURE_PATH = join(tmpdir(), 'githuman-e2e-fixture.json')
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  documents: string[]
  changeSetId: string
  version: number
  validationId: string
  reason: string
}

test('a pending archive request is reviewed, authorized and applied in the browser', async ({
  page,
  request
}) => {
  const pending = await request.post('/api/artifact-actions', {
    data: {
      kind: 'lifecycle',
      changeSetId: fixture.changeSetId,
      version: fixture.version,
      validationId: fixture.validationId
    }
  })
  expect(pending.ok()).toBe(true)

  await page.goto('/')
  await page
    .getByRole('button', { name: 'Artifact action requests: 1 pending' })
    .click()
  const dialog = page.getByRole('dialog')
  // The row is told apart by the reason of its package, not by the chat name.
  await dialog.getByRole('listitem').filter({ hasText: fixture.reason }).click()

  // The exact package is visible before any decision.
  await expect(dialog.getByText('Alpha')).toBeVisible()
  await expect(dialog.getByText('Beta')).toBeVisible()
  // The reason keeps a gap after its label.
  await expect(dialog.getByText(`Reason: ${fixture.reason}`)).toBeVisible()

  // Nothing can be authorized before the user reviews the scope.
  const authorize = dialog.getByRole('button', {
    name: 'Authorize this action'
  })
  await expect(authorize).toBeDisabled()
  await dialog.getByText('I reviewed this exact action').click()
  await expect(authorize).toBeEnabled()
  await authorize.click()

  await dialog.getByRole('button', { name: 'Apply approved action' }).click()
  await expect(
    dialog.getByText(/Applied: the change was committed/)
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Apply approved action' })
  ).toHaveCount(0)

  for (const id of fixture.documents) {
    const response = await request.get(`/api/artifacts/${id}`)
    expect((await response.json()).status).toBe('archived')
  }

  // A second request for the same validation is refused with the current versions.
  const replay = await request.post('/api/artifact-actions', {
    data: {
      kind: 'lifecycle',
      changeSetId: fixture.changeSetId,
      version: fixture.version,
      validationId: fixture.validationId
    }
  })
  expect(replay.status()).toBe(409)
  expect((await replay.json()).message).toContain('@v3')
})

test('a foreign Origin is refused as not local', async ({ request }) => {
  const response = await request.post('/api/artifact-actions', {
    headers: { origin: 'http://evil.example' },
    data: {}
  })
  expect(response.status()).toBe(403)
  expect((await response.json()).message).toContain('not local')
})
