import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCalendarDate,
  parseIsoTimestamp,
  toIsoString
} from '../../../src/shared/utils/date.ts'

test('calendar validation rejects rollover and preserves leap years and early years', () => {
  for (const value of [
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-99-99',
    '2026-1-01',
    ''
  ]) {
    assert.equal(isCalendarDate(value), false, value)
  }
  for (const value of [
    '2024-02-29',
    '2000-02-29',
    '0000-02-29',
    '0099-12-31'
  ]) {
    assert.equal(isCalendarDate(value), true, value)
  }
})

test('timestamps require real dates, valid times and an explicit zone', () => {
  for (const value of [
    'garbage',
    '2026-11-12',
    '2026-11-12T12:00:00',
    '2026-02-30T00:00:00Z',
    '2026-99-99T00:00:00Z',
    '2026-11-12T24:00:00Z',
    '2026-11-12T12:60:00Z',
    '2026-11-12T12:00:60Z',
    '2026-11-12T12:00:00+24:00',
    '2026-11-12T12:00:00+03:60',
    '2026-11-12T12:00:00.1234Z',
    ' 2026-11-12T12:00:00Z',
    '2026-11-12T12:00:00Z\n'
  ]) {
    assert.equal(parseIsoTimestamp(value), null, value)
  }
})

test('timestamps normalize offsets, fractions and epoch zero', () => {
  for (const value of [
    '2026-11-12T15:00:00+03:00',
    '2026-11-12T07:00:00-05:00',
    '2026-11-12T12:00:00Z'
  ]) {
    assert.equal(
      toIsoString(parseIsoTimestamp(value)!),
      '2026-11-12T12:00:00.000Z'
    )
  }
  assert.equal(parseIsoTimestamp('1970-01-01T00:00:00Z'), 0)
  assert.equal(
    toIsoString(parseIsoTimestamp('2024-02-29T00:00:00.1Z')!),
    '2024-02-29T00:00:00.100Z'
  )
  assert.equal(
    toIsoString(parseIsoTimestamp('0099-12-31T00:00:00Z')!),
    '0099-12-31T00:00:00.000Z'
  )
})
