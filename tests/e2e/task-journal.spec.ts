import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

for (const variant of [
  { theme: 'light', width: 1440, height: 1000 },
  { theme: 'dark', width: 390, height: 844 }
] as const) {
  test(`journal without task continuation in ${variant.theme} at ${variant.width}px`, async ({
    page,
    request
  }) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.emulateMedia({ colorScheme: variant.theme })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const response = await request.post('/api/tasks', {
      data: {
        requestId: randomUUID(),
        input: { title: `Journal ${variant.theme}`, state: 'open' }
      }
    })
    expect(response.ok()).toBe(true)
    const task = (await response.json()) as { id: string; storeId: string }
    for (const [kind, body] of [
      ['note', 'Use the persistent journal to continue.'],
      ['decision', 'Keep the task journal read-only.']
    ]) {
      const entry = await request.post(`/api/tasks/${task.id}/journal`, {
        data: { storeId: task.storeId, requestId: randomUUID(), kind, body }
      })
      expect(entry.ok()).toBe(true)
    }
    await page.goto(
      `/#/tasks/${task.id}?storeId=${task.storeId}&uiPane=content`
    )
    await expect(
      page.locator('.task-pane__tabs [role="tab"]').last()
    ).toHaveText('Journal')
    await page.getByRole('tab', { name: 'Journal', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Add entry', exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Correct', exact: true })
    ).toHaveCount(0)
    const search = page.getByRole('textbox', { name: 'Search journal entries' })
    await search.fill('persistent')
    const rows = page.locator('.task-journal .journal-list-item')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Use the persistent journal to continue.')
    await page
      .locator('.task-journal')
      .getByRole('button', { name: 'Filters', exact: true })
      .click()
    await expect(
      page.getByRole('combobox', { name: 'Agent name', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('combobox', { name: 'Model', exact: true })
    ).toBeVisible()
    await page.getByRole('combobox', { name: 'Entry kind' }).click()
    await page.getByRole('option', { name: 'Decision', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(rows).toHaveCount(0)
    await expect(
      page.getByText('No journal entries match your search and filters.')
    ).toBeVisible()
    await search.fill('read-only')
    await expect(rows).toHaveCount(1)
    await rows.click()
    const entryDialog = page.getByRole('dialog')
    await expect(entryDialog.locator('.journal-entry__body')).toHaveText(
      'Keep the task journal read-only.'
    )
    await expect(
      entryDialog.getByRole('button', { name: 'Correct', exact: true })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.screenshot({
      path: `/tmp/ght-task-journal-${variant.theme}.png`,
      fullPage: true
    })
    await expect(
      page
        .locator('.task-pane')
        .getByRole('button', { name: 'Continue in a new chat', exact: true })
    ).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('source chat becomes read-only and closing its successor restores the composer', async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  const task = (await (
    await request.post('/api/tasks', {
      data: {
        requestId: randomUUID(),
        input: { title: 'Read-only source', state: 'open' }
      }
    })
  ).json()) as { id: string; storeId: string }
  const source = (await (
    await request.post('/api/agent/sessions', {
      data: { presetId: 'e2e-journal', name: 'Handoff source' }
    })
  ).json()) as { id: string }
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/agent/sessions/${source.id}`)).json())
          .status
    )
    .toBe('ready')
  expect(
    (
      await request.patch(`/api/tasks/sessions/${source.id}`, {
        data: {
          requestId: randomUUID(),
          expectedVersion: 0,
          taskIds: [task.id]
        }
      })
    ).ok()
  ).toBe(true)
  await request.post(`/api/agent/sessions/${source.id}/prompt`, {
    data: { text: 'echo:Read-only source' }
  })
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/agent/sessions/${source.id}`)).json())
          .status
    )
    .toBe('ready')
  await page.goto(`/#/tasks/${task.id}?storeId=${task.storeId}&uiPane=agent`)
  await page.getByRole('tab', { name: /Handoff source/ }).click()
  await page
    .getByRole('button', { name: 'Continue in a new chat', exact: true })
    .filter({ visible: true })
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'New chat name' }).fill('Successor')
  await dialog.getByRole('combobox', { name: 'Harness', exact: true }).click()
  await page.getByRole('option', { name: 'e2e-journal', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Preview context', exact: true })
    .click()
  await expect(dialog.locator('pre')).toContainText('Read-only source')
  await dialog
    .getByRole('button', { name: 'Transfer and continue', exact: true })
    .click()
  await expect(dialog).toHaveCount(0, { timeout: 15000 })
  await page.getByRole('tab', { name: /Handoff source/ }).click()
  await expect(page.getByText(/This chat is read-only while/)).toBeVisible()
  await page.screenshot({
    path: '/tmp/ght142-readonly-narrow.png',
    fullPage: true
  })
  const current = (await (
    await request.get(`/api/agent/sessions/${source.id}`)
  ).json()) as { blockedBySessionId: string }
  expect(current.blockedBySessionId).toBeTruthy()
  await request.delete(`/api/agent/sessions/${current.blockedBySessionId}`)
  await expect(page.getByText(/This chat is read-only while/)).toHaveCount(0)
  await expect(
    page
      .getByRole('button', { name: 'Continue in a new chat', exact: true })
      .filter({ visible: true })
  ).toBeEnabled()
  await page.screenshot({
    path: '/tmp/ght142-restored-narrow.png',
    fullPage: true
  })
  expect(
    (
      await request.post(`/api/agent/sessions/${source.id}/prompt`, {
        data: { text: 'echo:restored' }
      })
    ).status()
  ).toBe(202)
  await request.delete(`/api/agent/sessions/${source.id}`)
})

test('composer transfers an unassigned session and automatically starts the successor', async ({
  page,
  request
}) => {
  const source = (await (
    await request.post('/api/agent/sessions', {
      data: { presetId: 'e2e-journal', name: 'Unassigned source' }
    })
  ).json()) as { id: string }
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/agent/sessions/${source.id}`)).json())
          .status
    )
    .toBe('ready')
  await request.post(`/api/agent/sessions/${source.id}/prompt`, {
    data: { text: 'echo:Keep the original objective' }
  })
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/agent/sessions/${source.id}`)).json())
          .status
    )
    .toBe('ready')
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Agent chat', exact: true }).click()
  await page.getByRole('tab', { name: /Unassigned source/ }).click()
  const button = page
    .locator('.agent-composer')
    .getByRole('button', { name: 'Continue in a new chat', exact: true })
    .filter({ visible: true })
  await expect(button).toBeEnabled()
  await button.click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByRole('textbox', { name: 'New chat name' })
    .fill('Unassigned successor')
  await dialog
    .getByRole('button', { name: 'Preview context', exact: true })
    .click()
  await expect(dialog.locator('pre')).toContainText(
    'Keep the original objective'
  )
  await expect(dialog.locator('pre')).toContainText(source.id)
  await dialog
    .getByRole('button', { name: 'Transfer and continue', exact: true })
    .click()
  await expect(dialog).toHaveCount(0, { timeout: 15000 })
  const sessions = (await (
    await request.get('/api/agent/sessions')
  ).json()) as {
    id: string
    name: string
    taskIds: string[]
    hasInitialContext: boolean
  }[]
  const target = sessions.find(
    session => session.name === 'Unassigned successor'
  )!
  expect(target).toBeTruthy()
  expect(target.taskIds).toEqual([])
  expect(target.hasInitialContext).toBe(false)
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/agent/sessions/${target.id}`)).json())
          .status
    )
    .toBe('ready')
  await expect(page.locator('.agent-view:visible')).toContainText(
    'Briefly summarize'
  )
  await page.screenshot({
    path: '/tmp/ght-session-handoff.png',
    fullPage: true
  })
  await request.delete(`/api/agent/sessions/${target.id}`)
  await request.delete(`/api/agent/sessions/${source.id}`)
})
