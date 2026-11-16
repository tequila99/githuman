import { test, expect } from '@playwright/test'

for (const variant of [
  { theme: 'light', width: 1440 },
  { theme: 'dark', width: 390 }
] as const) {
  test(`journal tool result inspection in ${variant.theme}`, async ({
    page,
    context
  }) => {
    await page.setViewportSize({ width: variant.width, height: 900 })
    await page.emulateMedia({ colorScheme: variant.theme })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const structured = {
      items: Array.from({ length: 120 }, (_, id) => ({ id }))
    }
    const body = JSON.stringify({
      type: 'tool_result',
      toolCallId: 'inspect-1',
      output: {
        result: {
          structuredContent: structured,
          content: [
            { type: 'text', text: '{"different":false}' },
            { type: 'text', text: '<img src=x onerror="alert(1)">' }
          ]
        }
      }
    })
    const inputs = JSON.stringify({
      type: 'tool_input',
      toolCallId: 'inspect-2',
      input: { search: 'tasks' }
    })
    const broken = '{"type":"tool_result","output":\n[truncated]'
    await page.route('**/api/task-journal?*', route =>
      route.fulfill({
        json: {
          storeId: 'test-store',
          throughSeq: 3,
          nextBeforeSeq: null,
          items: [body, inputs, broken].map((value, index) => ({
            id: `entry-${index}`,
            seq: 3 - index,
            storeId: 'test-store',
            taskId: null,
            taskTitle: null,
            isSuperseded: false,
            kind: 'system',
            eventType: 'agent_event',
            body: value,
            actor: { kind: 'system', id: 'server' },
            sessionId: null,
            turnId: null,
            supersedesEntryId: null,
            createdAt: '2026-11-13T12:00:00Z'
          }))
        }
      })
    )
    await page.goto('/#/journal')
    await expect(page.locator('.journal-list-item')).toHaveCount(3)
    await page.locator('.journal-list-item').first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.tool-content')).toHaveCount(0)
    await expect(dialog.locator('.journal-entry__body')).toHaveCSS(
      'text-decoration-line',
      'none'
    )
    const toggle = dialog.getByRole('button', {
      name: 'Show event data',
      exact: true
    })
    await expect(toggle).toHaveCSS('cursor', 'pointer')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await dialog.locator('.journal-entry__body').click()
    await expect(dialog.locator('.tool-content')).toHaveCount(0)
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(
      dialog.getByRole('button', { name: 'Hide event data', exact: true })
    ).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Space')
    await expect(dialog.locator('.tool-content')).toHaveCount(0)
    await dialog
      .getByRole('button', { name: 'Show event data', exact: true })
      .click()
    const code = dialog.locator('.code-content')
    await expect(
      dialog.getByRole('tab', { name: 'Structured result', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      code.getByText('Showing a preview.', { exact: false })
    ).toBeVisible()
    const before = await code.locator('.file-content-line').count()
    await code.getByRole('button', { name: 'Show more', exact: true }).click()
    await expect
      .poll(() => code.locator('.file-content-line').count())
      .toBeGreaterThan(before)
    await code
      .getByRole('button', { name: 'Copy full content', exact: true })
      .click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(JSON.stringify(structured, null, 2))
    await expect(
      code.locator('.file-content-line__content span[style]').first()
    ).toBeVisible()
    await dialog.getByRole('tab', { name: 'Content 1', exact: true }).click()
    await expect(code).toContainText('"different": false')
    await dialog.getByRole('tab', { name: 'Content 2', exact: true }).click()
    await expect(code).toContainText('<img src=x onerror="alert(1)">')
    await expect(code.locator('img')).toHaveCount(0)
    await dialog.getByRole('tab', { name: 'Event', exact: true }).click()
    await code
      .getByRole('button', { name: 'Copy full content', exact: true })
      .click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(body)
    await code.getByRole('button', { name: 'Wrap lines', exact: true }).click()
    await expect(code.locator('.file-content-line--wrap')).toHaveCount(0)
    await page.screenshot({
      path: `/tmp/ght-tool-content-${variant.theme}.png`,
      fullPage: true
    })
    expect(
      await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)
    ).toBe(true)
    await page.keyboard.press('Escape')
    await page.locator('.journal-list-item').nth(1).click()
    await dialog
      .getByRole('button', { name: 'Show event data', exact: true })
      .click()
    await expect(
      dialog.getByRole('tab', { name: 'Arguments', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('.code-content')).toContainText(
      '"search": "tasks"'
    )
    await page.keyboard.press('Escape')
    await page.locator('.journal-list-item').nth(2).click()
    await dialog
      .getByRole('button', { name: 'Show event data', exact: true })
      .click()
    await expect(dialog.getByRole('status')).toContainText(
      'truncated before display'
    )
    await dialog
      .getByRole('button', { name: 'Copy full content', exact: true })
      .click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(broken)
    expect(errors).toEqual([])
  })
}

test('chat lazily formats tool output and replaces tokens after an update', async ({
  page,
  request
}) => {
  const created = await request.post('/api/agent/sessions', {
    data: { presetId: 'e2e-journal', name: 'JSON inspector' }
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  async function ready() {
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/agent/sessions/${id}`)).json()).status
      )
      .toBe('ready')
  }
  try {
    await ready()
    await request.post(`/api/agent/sessions/${id}/prompt`, {
      data: { text: 'json-preview:first' }
    })
    await ready()
    await page.goto('/#/?uiPane=agent')
    await page
      .getByRole('button', { name: 'ready JSON inspector', exact: true })
      .click()
    await page.getByRole('tab', { name: /JSON inspector/ }).click()
    const card = page
      .locator('.agent-tool')
      .filter({ hasText: 'JSON preview tool' })
    await expect(card).toBeVisible()
    await expect(card.locator('.tool-content')).toHaveCount(0)
    await card.locator('.q-item').first().click()
    await expect(card.locator('.code-content')).toContainText(
      'json-preview:first'
    )
    await expect(card.locator('.code-content img')).toHaveCount(0)
    await card
      .getByRole('tab', { name: 'Original output', exact: true })
      .click()
    await request.post(`/api/agent/sessions/${id}/prompt`, {
      data: { text: 'json-preview:second' }
    })
    await ready()
    await expect(
      card.getByRole('tab', { name: 'Result', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(card.locator('.code-content')).toContainText(
      'json-preview:second'
    )
    await expect(card.locator('.code-content')).not.toContainText(
      'json-preview:first'
    )
    await expect(
      card.locator('.file-content-line__content span[style]').first()
    ).toBeVisible()
    await card.locator('.q-item').first().click()
    await expect(card.locator('.tool-content')).toHaveCount(0)
  } finally {
    await request.delete(`/api/agent/sessions/${id}`)
  }
})
