import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enhanceMermaidBlocks } from '@/utils/mermaid-blocks'

function pendingRender() {
  const result = Promise.withResolvers<string>()
  let mutations = 0
  const pre = {
    isConnected: true,
    classList: { add: () => mutations++ },
    replaceWith: () => mutations++,
    nextElementSibling: null,
    after: () => mutations++
  }
  let contained = true
  const root = {
    querySelectorAll: (selector: string) =>
      selector.startsWith('pre')
        ? [{ parentElement: pre, textContent: 'graph TD; A-->B' }]
        : [],
    contains: () => contained
  }
  const renderer = { render: () => result.promise }
  return {
    result,
    pre,
    root,
    renderer,
    detach: () => {
      contained = false
    },
    mutations: () => mutations
  }
}

for (const rejects of [false, true]) {
  test(`ignores an outdated ${rejects ? 'error' : 'diagram'} after a theme or text change`, async () => {
    const fixture = pendingRender()
    let current = true
    // The fake DOM only covers the stale-result path, which must never create DOM nodes.
    const pending = enhanceMermaidBlocks(
      fixture.root as unknown as HTMLElement,
      false,
      fixture.renderer,
      'Failed',
      () => current
    )
    current = false
    if (rejects) {
      fixture.result.reject(new Error('Old parse error'))
    } else {
      fixture.result.resolve('<svg />')
    }
    await pending
    assert.equal(fixture.mutations(), 0)
  })
}

for (const detach of ['disconnected', 'moved'] as const) {
  test(`ignores a diagram whose original block was ${detach}`, async () => {
    const fixture = pendingRender()
    const pending = enhanceMermaidBlocks(
      fixture.root as unknown as HTMLElement,
      false,
      fixture.renderer
    )
    if (detach === 'disconnected') {
      fixture.pre.isConnected = false
    } else {
      fixture.detach()
    }
    fixture.result.resolve('<svg />')
    await pending
    assert.equal(fixture.mutations(), 0)
  })
}
