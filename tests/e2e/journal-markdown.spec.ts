import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

for (const scope of ['project', 'task'] as const) {
  for (const variant of [
    { theme: 'light', width: 1440 },
    { theme: 'dark', width: 390 }
  ] as const) {
    test(`${scope} journal Markdown in ${variant.theme}`, async ({
      page,
      request
    }) => {
      await page.setViewportSize({ width: variant.width, height: 900 })
      await page.emulateMedia({ colorScheme: variant.theme })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const created = await request.post('/api/tasks', {
        data: {
          requestId: randomUUID(),
          input: { title: 'Markdown journal', state: 'open' }
        }
      })
      expect(created.ok()).toBe(true)
      const task = (await created.json()) as { id: string; storeId: string }
      const text = [
        '# **Рекомендация**',
        '',
        'Используйте `QExpansionItem` и [документацию](https://example.com/docs).',
        '',
        '- Первый пункт',
        '- Второй пункт',
        '',
        '```ts',
        'const value = "safe"',
        '```',
        '',
        '| Вариант | Решение |',
        '| --- | --- |',
        '| JSON | Сохранить |',
        '',
        '<img src=x onerror="alert(1)">',
        '',
        '![Внешняя картинка](https://example.com/image.png)',
        '',
        '[Небезопасная ссылка](javascript:alert(1))',
        '',
        'Продолжение сообщения. '.repeat(25),
        '',
        '**Конец полного сообщения**'
      ].join('\n')
      const body = JSON.stringify({ type: 'message', role: 'agent', text })
      const broken =
        '{"type":"message","role":"agent","text":"**cut\n[truncated]'
      const items = [
        { body },
        {
          body: JSON.stringify({
            type: 'message',
            role: 'thought',
            text: '**Неполное сообщение**',
            truncated: true
          })
        },
        { body: broken },
        {
          body: JSON.stringify({
            type: 'tool_result',
            toolCallId: '**raw-tool-id**',
            output: '**raw output**'
          })
        },
        {
          body: '**Решение агента**',
          eventType: null,
          kind: 'decision',
          actor: { kind: 'agent', id: 'closed-chat' }
        },
        {
          body: 'turn_finished',
          eventType: 'turn_finished',
          context: {
            presetId: 'test',
            agentName: 'Codex',
            sessionName: 'Closed chat',
            model: null,
            reasoning: null,
            settings: [],
            prompt: 'Request',
            response: '**Ответ агента**',
            promptTruncated: false,
            responseTruncated: false
          }
        }
      ].map((extra, index) => ({
        id: `markdown-${index}`,
        seq: 6 - index,
        storeId: task.storeId,
        taskId: task.id,
        taskTitle: 'Markdown journal',
        isSuperseded: false,
        kind: 'system',
        eventType: 'agent_event',
        actor: { kind: 'system', id: 'server' },
        sessionId: null,
        turnId: null,
        supersedesEntryId: null,
        createdAt: '2026-11-13T12:00:00Z',
        ...extra
      }))
      await page.route(
        scope === 'project'
          ? '**/api/task-journal?*'
          : `**/api/tasks/${task.id}/journal?*`,
        route =>
          route.fulfill({
            json: {
              storeId: task.storeId,
              throughSeq: 6,
              nextBeforeSeq: null,
              items
            }
          })
      )
      await page.goto(
        scope === 'project'
          ? '/#/journal'
          : `/#/tasks/${task.id}?storeId=${task.storeId}&tab=journal&uiPane=content`
      )
      const rows = page.locator('.journal-list-item')
      await expect(rows).toHaveCount(6)
      const title = rows.first().locator('.catalog-list-item__title')
      await expect(title).toContainText(
        'message · agent · Рекомендация Используйте QExpansionItem и документацию.'
      )
      await expect(title).not.toContainText('**')
      await expect(title).not.toContainText('https://example.com/docs')
      await expect(rows.locator('.md-content')).toHaveCount(0)
      await expect(rows.nth(4).locator('.catalog-list-item__title')).toHaveText(
        'Решение агента'
      )
      await expect(rows.nth(5).locator('.catalog-list-item__title')).toHaveText(
        'Ответ агента'
      )
      await rows.first().click()
      const dialog = page.getByRole('dialog')
      const markdown = dialog.locator('.md-content')
      await expect(markdown.locator('h1 strong')).toHaveText('Рекомендация')
      await expect(markdown.locator('li')).toHaveCount(2)
      await expect(markdown.locator('pre code')).toHaveText(
        'const value = "safe"\n'
      )
      await expect(markdown.locator('table')).toBeVisible()
      await expect(markdown.locator('strong').last()).toHaveText(
        'Конец полного сообщения'
      )
      await expect(
        markdown.getByRole('link', { name: 'документацию' })
      ).toHaveAttribute('href', 'https://example.com/docs')
      await expect(
        markdown.locator('img, script, a[href^="javascript:"]')
      ).toHaveCount(0)
      await expect(markdown).toContainText('<img src=x onerror="alert(1)">')
      await expect(dialog.locator('.tool-content')).toHaveCount(0)
      expect(
        await dialog.evaluate(
          element => element.scrollWidth <= element.clientWidth + 1
        )
      ).toBe(true)
      await page.screenshot({
        path: `/tmp/ght-journal-markdown-${scope}-${variant.theme}.png`,
        fullPage: true,
        animations: 'disabled'
      })
      await dialog
        .getByRole('button', { name: 'Show event data', exact: true })
        .click()
      await dialog.getByRole('tab', { name: 'Event', exact: true }).click()
      await expect(dialog.locator('.code-content')).toContainText(
        '**Рекомендация**'
      )
      await page.keyboard.press('Escape')
      await rows.nth(1).click()
      await expect(dialog.locator('.md-content strong')).toHaveText(
        'Неполное сообщение'
      )
      await expect(dialog.getByRole('status')).toContainText(
        'truncated before display'
      )
      await page.keyboard.press('Escape')
      await rows.nth(2).click()
      await expect(dialog.locator('.md-content')).toHaveCount(0)
      await expect(dialog.locator('.journal-entry__body')).toContainText(
        '[truncated]'
      )
      await page.keyboard.press('Escape')
      await rows.nth(3).click()
      await expect(dialog.locator('.md-content')).toHaveCount(0)
      await expect(dialog.locator('.journal-entry__body')).toContainText(
        '**raw-tool-id**'
      )
      await page.keyboard.press('Escape')
      await rows.nth(4).click()
      await expect(dialog.locator('.md-content strong')).toHaveText(
        'Решение агента'
      )
      await page.keyboard.press('Escape')
      await rows.nth(5).click()
      await expect(dialog.locator('.md-content strong')).toHaveText(
        'Ответ агента'
      )
      expect(errors).toEqual([])
    })
  }
}
