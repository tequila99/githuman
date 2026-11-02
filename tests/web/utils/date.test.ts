import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { isCalendarDate, localDayStartIso, localDayEndIso } from '@/utils/date'

test('calendar dates reject malformed and impossible days without throwing', () => {
  for (const value of [
    '2026-99-99',
    '2026-00-01',
    '2026-01-00',
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    ''
  ]) {
    assert.equal(isCalendarDate(value), false, value)
    assert.throws(() => localDayStartIso(value), RangeError)
    assert.throws(() => localDayEndIso(value), RangeError)
  }
  for (const value of [
    '2024-02-29',
    '2000-02-29',
    '0000-02-29',
    '0099-12-31',
    '2026-11-01'
  ]) {
    assert.equal(isCalendarDate(value), true, value)
  }
})

test('local day bounds follow daylight saving transitions and preserve early years', () => {
  const moduleUrl = new URL('../../../src/web/utils/date.ts', import.meta.url)
    .href
  const readBounds = (timeZone: string, days: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
    import { localDayStartIso, localDayEndIso } from ${JSON.stringify(moduleUrl)}
    console.log(JSON.stringify(${JSON.stringify(days)}.map(day => [localDayStartIso(day), localDayEndIso(day)])))
  `
        ],
        { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' }
      )
    )
  assert.deepEqual(
    readBounds('America/New_York', ['2026-03-08', '2026-11-01']),
    [
      ['2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z'],
      ['2026-11-01T04:00:00.000Z', '2026-11-02T04:59:59.999Z']
    ]
  )
  assert.deepEqual(readBounds('UTC', ['0000-01-01', '0099-12-31']), [
    ['0000-01-01T00:00:00.000Z', '0000-01-01T23:59:59.999Z'],
    ['0099-12-31T00:00:00.000Z', '0099-12-31T23:59:59.999Z']
  ])
})
