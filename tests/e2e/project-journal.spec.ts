import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('ordinary agent without a task appears in the project journal', async ({
  page,
  request
}) => {
  const marker = `Unassigned-${randomUUID()}`
  const created = await request.post('/api/agent/sessions', {
    data: { presetId: 'e2e-journal' }
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  try {
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/agent/sessions/${id}`)).json()).status
      )
      .toBe('ready')
    const prompted = await request.post(`/api/agent/sessions/${id}/prompt`, {
      data: { text: marker }
    })
    expect(prompted.status()).toBe(202)
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/task-journal?query=${marker}`)
            ).json()
          ).items.filter(
            (entry: { eventType: string }) =>
              entry.eventType === 'turn_finished'
          ).length
      )
      .toBe(1)
    const entries = (
      await (await request.get(`/api/task-journal?query=${marker}`)).json()
    ).items
    const messages = entries.filter(
      (entry: { eventType: string }) => entry.eventType === 'agent_event'
    )
    expect(messages.length).toBeGreaterThan(0)
    for (const entry of messages) {
      expect(entry.provenance.agentName).toBeTruthy()
      expect(entry.provenance.model).toBe('m1')
      expect(entry.provenance).not.toHaveProperty('prompt')
      expect(entry.provenance).not.toHaveProperty('response')
    }
    await page.goto(`/#/journal?q=${marker}`)
    const row = page
      .locator('.journal-list-item')
      .filter({ hasText: marker })
      .first()
    await expect(row.getByText('No task', { exact: true })).toBeVisible()
    await expect(
      row.getByRole('link', { name: 'No task', exact: true })
    ).toHaveCount(0)
    await expect(row.locator('.catalog-list-item__icon svg')).toBeVisible()
    await expect(row.locator('.journal-provenance__tag--model')).toHaveText(
      'm1'
    )
    await row.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('No task', { exact: true })).toBeVisible()
    await expect(dialog.getByText(marker, { exact: true })).toBeVisible()
    await expect(
      dialog
        .locator('.journal-entry__body')
        .filter({ hasText: `echo:${marker}` })
    ).toBeVisible()
    await page.screenshot({
      path: '/tmp/ght-journal-unassigned.png',
      fullPage: true
    })
    await page.keyboard.press('Escape')
    await page
      .locator('.journal-list-item')
      .filter({ hasText: `request · ${marker}` })
      .click()
    const activity = page.getByRole('dialog')
    await expect(
      activity.locator('.journal-provenance__tag--agent')
    ).toBeVisible()
    await expect(
      activity.locator('.journal-provenance__tag--model')
    ).toHaveText('m1')
    await expect(activity.getByText('Request', { exact: true })).toHaveCount(0)
    await activity
      .getByRole('button', { name: 'Show event data', exact: true })
      .click()
    await expect(activity.locator('.code-content')).toContainText(marker)
    await expect(activity.locator('.code-content')).toContainText('request')
  } finally {
    await request.delete(`/api/agent/sessions/${id}`)
  }
})

for (const variant of [
  { theme: 'light', width: 1440, height: 1000 },
  { theme: 'dark', width: 390, height: 844 }
] as const) {
  test(`full journal search and filters in ${variant.theme} at ${variant.width}px`, async ({
    page,
    request
  }) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.emulateMedia({ colorScheme: variant.theme })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    async function task(title: string) {
      const response = await request.post('/api/tasks', {
        data: { requestId: randomUUID(), input: { title, state: 'open' } }
      })
      expect(response.ok()).toBe(true)
      return (await response.json()) as {
        id: string
        storeId: string
        version: number
        title: string
      }
    }
    const closed = await task(`Journal archive ${variant.theme}`)
    const active = await task(`Journal active ${variant.theme}`)
    const marker = `buried-${randomUUID()}`
    async function append(taskId: string, body: string, kind = 'note') {
      const response = await request.post(`/api/tasks/${taskId}/journal`, {
        data: { requestId: randomUUID(), storeId: active.storeId, body, kind }
      })
      expect(response.ok()).toBe(true)
    }
    await append(closed.id, marker, 'decision')
    for (let i = 0; i < 35; i++) await append(active.id, `Recent journal ${i}`)
    const closing = await request.patch(`/api/tasks/${closed.id}`, {
      data: {
        requestId: randomUUID(),
        expectedVersion: closed.version,
        input: { title: closed.title, state: 'closed' }
      }
    })
    expect(closing.ok()).toBe(true)
    await page.goto('/#/')
    if (variant.width < 900) {
      await page
        .getByRole('button', { name: 'Toggle menu', exact: true })
        .click()
    }
    await page.getByRole('link', { name: 'Journal', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Journal', exact: true })
    ).toBeVisible()
    await expect(
      page.getByText('Recent journal 34', { exact: true })
    ).toBeVisible()
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0)
    const search = page.getByRole('textbox', { name: 'Search journal entries' })
    await search.fill(marker)
    await expect(page.getByText(marker, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByRole('combobox', { name: 'Entry kind', exact: true })
      .click()
    await page.getByRole('option', { name: 'Note', exact: true }).click()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(
      page.getByText('No journal entries match your search and filters.', {
        exact: true
      })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Reset filters', exact: true })
      .click()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByText(marker, { exact: true })).toBeVisible()
    await page.reload()
    await expect(search).toHaveValue(marker)
    await expect(page.getByText(marker, { exact: true })).toBeVisible()
    await page.screenshot({
      path: `/tmp/ght-project-journal-${variant.theme}.png`,
      fullPage: true
    })
    await page.getByRole('link', { name: closed.title, exact: true }).click()
    await expect(
      page.getByRole('tab', { name: 'Journal', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(marker, { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('journal virtualizes loaded pages and opens the full multiline entry', async ({
  page
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const taskId = randomUUID()
  const storeId = randomUUID()
  const fullText =
    'Oldest journal entry\n' + 'Full detail remains readable.\n'.repeat(80)
  let loaded = 0
  await page.route('**/api/task-journal?*', async route => {
    const query = new URL(route.request().url()).searchParams
    const before = Number(query.get('beforeSeq') ?? 181)
    const top = Math.min(180, before - 1)
    const items = Array.from({ length: Math.min(30, top) }, (_, index) => {
      const seq = top - index
      return {
        seq,
        id: String(seq),
        storeId,
        taskId,
        taskTitle: 'Virtual journal task',
        isSuperseded: false,
        kind: 'note',
        eventType: null,
        body: seq === 1 ? fullText : `Journal row ${seq}`,
        actor:
          seq === 180
            ? { kind: 'agent', id: 'historical-chat' }
            : { kind: 'user', id: 'local' },
        sessionId: seq === 180 ? 'historical-chat' : null,
        turnId: seq === 180 ? 'historical-response' : null,
        supersedesEntryId: null,
        createdAt: '2026-11-12T12:00:00.000Z'
      }
    })
    loaded = Math.max(loaded, 181 - before + items.length)
    await route.fulfill({
      json: {
        storeId,
        items,
        throughSeq: 180,
        nextBeforeSeq: top > 30 ? items.at(-1)!.seq : null
      }
    })
  })
  await page.goto('/#/journal')
  const list = page.locator('.virtual-infinite-list')
  const scroll = list.locator('.q-scrollarea__container')
  await expect(list.locator('.q-item')).not.toHaveCount(0)
  await expect(
    list.locator('.journal-provenance__tag--model').first()
  ).toHaveText('Not reported')
  for (let target = 60; target <= 180; target += 30) {
    await expect
      .poll(async () => {
        await scroll.evaluate(element => {
          element.scrollTop = element.scrollHeight
        })
        return loaded
      })
      .toBeGreaterThanOrEqual(target)
  }
  await expect.poll(() => list.locator('.q-item').count()).toBeLessThan(80)
  await expect
    .poll(async () => {
      await scroll.evaluate(element => {
        element.scrollTop = element.scrollHeight
      })
      return list.getByText(/Oldest journal entry/).isVisible()
    })
    .toBe(true)
  await list.getByText(/Oldest journal entry/).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.journal-entry__body')).toHaveText(fullText)
  await page.screenshot({
    path: '/tmp/ght-journal-entry-detail.png',
    fullPage: true,
    animations: 'disabled'
  })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) {
  test(`journal shows persistent decision provenance in ${theme}`, async ({
    page
  }) => {
    await page.setViewportSize({
      width: theme === 'dark' ? 390 : 1440,
      height: 900
    })
    await page.emulateMedia({ colorScheme: theme })
    const sessionId = 'd80b06a6-9de0-4cbf-8d93-d1c53888c855'
    const context = {
      presetId: 'codex',
      agentName: 'Codex',
      sessionName: 'Design discussion',
      model: 'gpt-6.1',
      reasoning: 'high',
      settings: [
        { id: 'thought_level', name: 'Reasoning level', value: 'high' }
      ],
      prompt: 'Why should the journal retain agent provenance?',
      response:
        'Keep an immutable snapshot so each decision can be traced after closing the chat.',
      promptTruncated: false,
      responseTruncated: false,
      references: ['src/server/services/task-journal.service.ts']
    }
    await page.route('**/api/task-journal?*', route =>
      route.fulfill({
        json: {
          storeId: 'test-store',
          throughSeq: 1,
          nextBeforeSeq: null,
          items: [
            {
              id: 'decision-event',
              seq: 1,
              storeId: 'test-store',
              taskId: 'test-task',
              taskTitle: 'Decision history',
              kind: 'system',
              eventType: 'turn_finished',
              body: 'turn_finished',
              actor: { kind: 'system', id: 'server' },
              sessionId,
              turnId: 'response-123',
              context,
              supersedesEntryId: null,
              isSuperseded: false,
              createdAt: '2026-11-12T12:00:00Z'
            }
          ]
        }
      })
    )
    await page.goto('/#/journal')
    await expect(
      page.getByText(context.response, { exact: true })
    ).toBeVisible()
    const session = page.getByText(`Session: ${sessionId}`, { exact: true })
    if (theme === 'dark') {
      await expect(session).toBeHidden()
    } else {
      await expect(session).toBeVisible()
    }
    const row = page.locator('.journal-list-item')
    for (const value of ['Codex', 'gpt-6.1', 'high']) {
      await expect(row.getByText(value, { exact: true })).toBeVisible()
    }
    const sizes = await row.evaluate(element => ({
      metadata: getComputedStyle(element.querySelector('time')!).fontSize,
      tag: getComputedStyle(element.querySelector('.journal-provenance__tag')!)
        .fontSize
    }))
    expect(sizes.tag).toBe(sizes.metadata)
    await expect(row.getByText('System fact', { exact: true })).toHaveCount(0)
    await expect(row.getByText('GitHuman', { exact: true })).toHaveCount(0)
    const grouping = page.getByRole('button', {
      name: 'Group by task',
      exact: true
    })
    await grouping.click()
    await expect(grouping).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.project-journal__group')).toHaveText(
      'Decision history'
    )
    await page.reload()
    await expect(grouping).toHaveAttribute('aria-pressed', 'true')
    await page.getByText(context.response, { exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText(context.prompt, { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText(context.response, { exact: true })
    ).toBeVisible()
    await expect(dialog.getByText('gpt-6.1', { exact: true })).toBeVisible()
    await expect(dialog.getByText('high', { exact: true })).toBeVisible()
    await expect(
      dialog.getByText('Chat is no longer available', { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText('Response ID: response-123', { exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: `/tmp/ght-journal-provenance-${theme}.png`,
      animations: 'disabled',
      fullPage: true
    })
  })
}
