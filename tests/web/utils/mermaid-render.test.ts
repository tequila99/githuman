import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMermaidRenderer, type MermaidLike } from '@/utils/mermaid-render'

function fakeMermaid() {
  const calls = {
    loads: 0,
    initialized: [] as string[],
    rendered: [] as string[],
    running: 0,
    maxRunning: 0
  }
  const mermaid: MermaidLike = {
    initialize: config => void calls.initialized.push(config.theme),
    async render(id, text) {
      calls.running += 1
      calls.maxRunning = Math.max(calls.maxRunning, calls.running)
      await new Promise(resolve => setTimeout(resolve, 5))
      calls.running -= 1
      if (text.includes('BROKEN')) throw new Error('Parse error')
      calls.rendered.push(text)
      return { svg: `<svg id="${id}">${text}</svg>` }
    }
  }
  const load = async () => {
    calls.loads += 1
    return mermaid
  }
  return { calls, load }
}

test('renders to an svg string and loads the library only when asked', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  assert.equal(calls.loads, 0)
  const svg = await renderer.render('graph TD; A-->B', false)
  assert.match(svg, /^<svg id="agent-mermaid-\d+">graph TD; A-->B<\/svg>$/)
  assert.equal(calls.loads, 1)
})

test('the same source and theme is rendered once (streaming re-renders hit the cache)', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  const [a, b] = await Promise.all([
    renderer.render('graph TD; A-->B', false),
    renderer.render('graph TD; A-->B', false)
  ])
  assert.equal(a, b)
  await renderer.render('graph TD; A-->B', false)
  assert.equal(calls.rendered.length, 1)
})

test('a theme change re-initialises mermaid and renders again', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  await renderer.render('graph TD; A-->B', false)
  await renderer.render('graph TD; A-->B', true)
  await renderer.render('graph TD; C-->D', true)
  assert.deepEqual(calls.initialized, ['default', 'dark'])
  assert.equal(calls.rendered.length, 3)
})

test('renders run one at a time', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  await Promise.all(
    ['a', 'b', 'c', 'd'].map(s => renderer.render(`graph TD; ${s}-->z`, false))
  )
  assert.equal(calls.maxRunning, 1)
})

test('a parse error rejects, is remembered, and does not block later diagrams', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  await assert.rejects(renderer.render('BROKEN', false), /Parse error/)
  await assert.rejects(renderer.render('BROKEN', false), /Parse error/)
  assert.match(await renderer.render('graph TD; A-->B', false), /<svg/)
  assert.equal(calls.rendered.length, 1)
})

const source = (i: number) => `graph TD; A${i}-->B`

test('the cache is bounded: the oldest diagram is rendered again, a recent one is not', async () => {
  const { calls, load } = fakeMermaid()
  const renderer = createMermaidRenderer(load)
  for (let i = 0; i < 60; i++) {
    await renderer.render(source(i), false)
    // Diagram 1 is used again, so it outlives diagram 2 (which is older).
    if (i === 30) await renderer.render(source(1), false)
  }
  const before = calls.rendered.length
  await renderer.render(source(59), false)
  assert.equal(calls.rendered.length, before, 'recent: still cached')
  await renderer.render(source(2), false)
  assert.equal(calls.rendered.length, before + 1, 'old: rendered again')
})
