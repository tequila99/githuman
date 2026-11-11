import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect } from '@playwright/test'

// The fixture belongs to a temporary repository, never to the user's store.
const FIXTURE_PATH = join(tmpdir(), 'githuman-e2e-fixture.json')
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  storeId: string
  transitionDocumentId: string
}

for (const variant of [
  { theme: 'light', width: 1440, height: 1000 },
  { theme: 'dark', width: 390, height: 844 }
] as const) {
  test(`a transition report survives expiry in ${variant.theme} at ${variant.width}px`, async ({
    page,
    request
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.emulateMedia({ colorScheme: variant.theme })
    await page.clock.install()
    await page.goto(
      `/#/artifacts?storeId=${fixture.storeId}&selectedId=${fixture.transitionDocumentId}&uiPane=content`
    )
    const result = page.getByRole('button', {
      name: 'Validation result',
      exact: true
    })
    await expect(result).toBeVisible()
    await expect(page.locator('body')).toHaveClass(
      new RegExp(`body--${variant.theme}`)
    )
    await page.reload()
    await expect(result).toBeVisible()
    await result.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    const resolution = dialog.getByText(
      'Keep this draft until its open question is resolved.'
    )
    await expect(resolution).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await result.click()
    await expect(resolution).toBeVisible()

    const pageNow = await page.evaluate(() => Date.now())
    await page.clock.setFixedTime(pageNow + 11 * 60_000)
    const current = await request.get(
      `/api/artifacts/${fixture.transitionDocumentId}`
    )
    const artifact = await current.json()
    const refreshed = await request.patch(
      `/api/artifacts/${fixture.transitionDocumentId}/metadata`,
      {
        data: {
          requestId: `expiry-${variant.theme}`,
          expectedVersion: artifact.metadataVersion,
          metadata: {
            title: artifact.title,
            tags: [`checked-${variant.theme}`]
          }
        }
      }
    )
    expect(refreshed.ok()).toBe(true)
    await expect(page.locator('.artifact-transition-progress')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(resolution).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('report-after-expiry.png'),
      animations: 'disabled'
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(pageErrors).toEqual([])
  })
}

for (const variant of [
  { theme: 'light', width: 1440, height: 1000 },
  { theme: 'dark', width: 390, height: 844 }
] as const) {
  test(`required reading progress updates in ${variant.theme} at ${variant.width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    await page.emulateMedia({ colorScheme: variant.theme })
    let readRequired = 1
    await page.route(
      `**/api/artifacts/${fixture.transitionDocumentId}/transition-operations`,
      async route => {
        const response = await route.fetch()
        const body = await response.json()
        body.items = body.items.map((operation: Record<string, unknown>) => ({
          ...operation,
          stage: 'validating',
          canCancel: false,
          reason: null,
          validationProgress: {
            readBytes: readRequired * 100,
            totalBytes: 300,
            readRequired,
            totalRequired: 3,
            remainingRequired: 3 - readRequired
          }
        }))
        await route.fulfill({ response, json: body })
      }
    )
    await page.goto(
      `/#/artifacts?storeId=${fixture.storeId}&selectedId=${fixture.transitionDocumentId}&uiPane=content`
    )
    await expect(
      page.getByText('Read 1 of 3 documents', { exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('reading-progress.png'),
      animations: 'disabled'
    })
    readRequired = 2
    await page.reload()
    await expect(
      page.getByText('Read 2 of 3 documents', { exact: true })
    ).toBeVisible()
  })
}
