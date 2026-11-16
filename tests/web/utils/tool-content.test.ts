import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatToolText,
  toolContent,
  toolTextPreview,
  TOOL_MAX_PREVIEW_CHARS
} from '@/utils/tool-content'

function journal(output: unknown) {
  return JSON.stringify({ type: 'tool_result', toolCallId: 'call-1', output })
}

test('unwraps a known MCP transport and preserves structured and all content blocks', () => {
  const source = journal({
    result: {
      structuredContent: { items: [1] },
      content: [
        { type: 'text', text: '{"items":[2]}' },
        { type: 'text', text: '' },
        { type: 'image', mimeType: 'image/png', data: 'untrusted' },
        { type: 'resource_link', uri: 'javascript:alert(1)' }
      ]
    }
  })
  const view = toolContent(source, 'journal')
  assert.equal(view.toolCallId, 'call-1')
  assert.equal(view.sections.length, 6)
  assert.deepEqual(JSON.parse(view.sections[0]!.text), { items: [1] })
  assert.deepEqual(JSON.parse(view.sections[1]!.text), { items: [2] })
  assert.equal(view.sections[2]!.text, '')
  assert.equal(JSON.parse(view.sections[3]!.text).data, 'untrusted')
  assert.equal(JSON.parse(view.sections[4]!.text).uri, 'javascript:alert(1)')
  assert.equal(view.sections.at(-1)!.text, source)
})

test('keeps business objects with result/content fields and arbitrary nested JSON strings', () => {
  const value = {
    result: { content: ['invoice'], total: 12 },
    text: '{"nested":true}'
  }
  const view = toolContent(journal(value), 'journal')
  assert.deepEqual(JSON.parse(view.sections[0]!.text), value)
  assert.equal(typeof JSON.parse(view.sections[0]!.text).text, 'string')
  assert.deepEqual(
    JSON.parse(toolContent('{"result":42}', 'chat').sections[0]!.text),
    { result: 42 }
  )
})

test('handles every JSON primitive, empty MCP content and explicit empty fields', () => {
  for (const value of [null, false, 0, '', [], {}]) {
    const view = toolContent(journal(value), 'journal')
    assert.equal(view.sections[0]!.id, 'result')
    assert.equal(
      view.sections[0]!.text,
      typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    )
  }
  for (const text of ['null', 'false', '0', '""', '[]']) {
    assert.equal(formatToolText(text).json, true)
  }
  const view = toolContent(
    journal({ structuredContent: false, content: [] }),
    'journal'
  )
  assert.equal(view.sections[0]!.text, 'false')
  assert.equal(
    toolContent(journal({ content: [] }), 'journal').sections[0]!.text,
    '{\n  "content": []\n}'
  )
})

test('arguments are shown only when present, including null input', () => {
  const source = JSON.stringify({
    type: 'tool_input',
    input: null,
    toolCallId: 'a'
  })
  assert.equal(toolContent(source, 'journal').sections[0]!.label, 'arguments')
  assert.equal(toolContent(source, 'journal').sections[0]!.text, 'null')
  assert.equal(
    toolContent(journal(42), 'journal').sections.some(
      s => s.label === 'arguments'
    ),
    false
  )
})

test('preserves malformed and truncated sources without fabricating JSON or missing data', () => {
  const malformed = '{"broken":'
  assert.equal(toolContent(malformed, 'journal').truncated, false)
  assert.deepEqual(
    toolContent(malformed, 'journal').sections.map(s => s.text),
    [malformed]
  )
  for (const [kind, marker] of [
    ['journal', '\n[truncated]'],
    ['chat', '\n… (truncated)']
  ] as const) {
    const source = malformed + marker
    const view = toolContent(source, kind)
    assert.equal(view.truncated, true)
    assert.equal(view.sections.at(-1)!.text, source)
    assert.equal(view.sections.at(-1)!.json, false)
  }
  const validPrefix =
    journal({ content: [{ type: 'text', text: '[truncated]' }] }) +
    '\n[truncated]'
  assert.equal(
    toolContent(validPrefix, 'journal').sections[0]!.text,
    '[truncated]'
  )
  assert.equal(toolContent(validPrefix, 'journal').truncated, true)
  assert.equal(
    toolContent(journal({ text: '[truncated]' }), 'journal').truncated,
    false
  )
})

test('bounds parsing, nesting, formatting expansion and long-line DOM previews', () => {
  const large = 'x'.repeat(100_000)
  assert.equal(formatToolText(large).limited, true)
  assert.equal(formatToolText(large).text, large)
  const deep = '['.repeat(40) + '0' + ']'.repeat(40)
  assert.equal(formatToolText(deep).limited, true)
  assert.equal(formatToolText(deep).text, deep)
  const many = JSON.stringify(Array.from({ length: 15_000 }, () => 0))
  assert.equal(formatToolText(many).limited, true)
  const preview = toolTextPreview(large)
  assert.equal(preview.hidden, true)
  assert.equal(preview.canExpand, true)
  assert.ok(preview.text.length < large.length)
  const final = toolTextPreview(large, 100)
  assert.equal(final.text.length, TOOL_MAX_PREVIEW_CHARS)
  assert.equal(final.canExpand, false)
  const lines = toolTextPreview('a\n'.repeat(1000))
  assert.equal(lines.text.split('\n').length, 100)
})

test('keeps HTML as plain data and never mutates the original source', () => {
  const html = '<img src=x onerror="alert(1)">'
  const source = journal({ content: [{ type: 'text', text: html }] })
  const view = toolContent(source, 'journal')
  assert.equal(view.sections[0]!.text, html)
  assert.equal(view.sections[0]!.json, false)
  assert.equal(view.sections.at(-1)!.text, source)
  assert.equal(
    toolContent('{"new":true}', 'chat').sections[0]!.text,
    '{\n  "new": true\n}'
  )
})
