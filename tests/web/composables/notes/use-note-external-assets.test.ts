import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { useNoteExternalAssets } from '@/composables/notes/use-note-external-assets'
import type {
  ImportExternalAsset,
  ExternalAssetResult
} from '../../../../src/shared/notes/types.ts'

type PreviewApi = {
  inspectExternalAsset?: (
    url: string,
    kind: 'image' | 'pdf',
    signal?: AbortSignal
  ) => Promise<{ size: number | null }>
  previewExternalAsset?: (url: string, signal?: AbortSignal) => Promise<Blob>
}

function setup(
  importAsset: (
    input: ImportExternalAsset,
    signal?: AbortSignal
  ) => Promise<ExternalAssetResult>,
  text = '![](https://example.com/a.png)\n\n[PDF](https://example.com/b.pdf)',
  previewApi: PreviewApi = {}
) {
  const draft = ref({
    id: 'a',
    storageId: 'store',
    path: 'a.md',
    text,
    status: 'dirty'
  })
  const scope = effectScope()
  let empty = 0
  let changes = 0
  const assets = scope.run(() =>
    useNoteExternalAssets(draft, {
      apply: value => {
        draft.value.text = value
        changes++
      },
      empty: () => {
        empty++
      },
      api: {
        importExternalAsset: importAsset,
        inspectExternalAsset:
          previewApi.inspectExternalAsset ?? (async () => ({ size: null })),
        previewExternalAsset:
          previewApi.previewExternalAsset ?? (async () => new Blob())
      }
    })
  )!
  return {
    draft,
    scope,
    assets,
    get empty() {
      return empty
    },
    get changes() {
      return changes
    }
  }
}

test('empty documents notify without opening a dialog', () => {
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    'No assets'
  )
  state.assets.open()
  assert.equal(state.empty, 1)
  assert.equal(state.assets.opened.value, false)
  state.scope.stop()
})
test('selection, partial success and guarded restore preserve source and new edits', async () => {
  const state = setup(async input =>
    input.kind === 'image'
      ? {
          status: 'stored',
          url: '/api/notes/assets/a.png',
          bytes: 20,
          format: 'png'
        }
      : { status: 'rejected', reason: 'file-too-large' }
  )
  state.assets.open()
  assert.equal(
    state.assets.rows.value.every(row => row.selected),
    true
  )
  state.assets.selectAll(false)
  await state.assets.download()
  assert.equal(state.changes, 0)
  state.assets.selectAll(true)
  await state.assets.download()
  assert.equal(state.changes, 1)
  assert.equal(state.assets.replacements.value, 1)
  assert.match(state.draft.value.text, /\/api\/notes\/assets\/a.png/)
  assert.match(state.draft.value.text, /https:\/\/example.com\/b.pdf/)
  assert.equal(state.assets.canRestore.value, true)
  state.assets.restore()
  assert.match(state.draft.value.text, /https:\/\/example.com\/a.png/)
  await state.assets.download()
  state.draft.value.text += '\nNew edit'
  assert.equal(state.assets.canRestore.value, false)
  state.assets.restore()
  assert.match(state.draft.value.text, /New edit/)
  state.scope.stop()
})
test('PDF confirmation is specific, explicit and preserves remaining operation budget', async () => {
  const attempts: ImportExternalAsset[] = []
  const state = setup(async input => {
    attempts.push(input)
    return input.allowLargePdf
      ? {
          status: 'stored',
          url: '/api/notes/assets/b.pdf',
          bytes: 60000000,
          format: 'pdf'
        }
      : { status: 'confirmation-required', size: null }
  }, '[PDF](https://example.com/b.pdf)')
  state.assets.open()
  const pending = state.assets.download()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.assets.rows.value[0]?.state, 'confirmation')
  state.assets.confirm(true)
  await pending
  assert.deepEqual(
    attempts.map(item => item.allowLargePdf),
    [false, true]
  )
  assert.equal(attempts[1]?.remainingBytes, 200000000)
  assert.match(state.draft.value.text, /\/api\/notes\/assets\/b.pdf/)
  state.scope.stop()
})
test('changing notes discards late results and never writes into the new draft', async () => {
  let finish: ((value: ExternalAssetResult) => void) | undefined
  const state = setup(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  state.assets.open()
  const pending = state.assets.download()
  state.draft.value = { ...state.draft.value, id: 'b', text: 'Other note' }
  finish?.({
    status: 'stored',
    url: '/api/notes/assets/a.png',
    bytes: 20,
    format: 'png'
  })
  await pending
  assert.equal(state.draft.value.text, 'Other note')
  assert.equal(state.changes, 0)
  assert.equal(state.assets.opened.value, false)
  state.scope.stop()
})
test('reparses current text so fresh edits survive and removed links are not resurrected', async () => {
  let finish: ((value: ExternalAssetResult) => void) | undefined
  const state = setup(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
    '![](https://example.com/a.png)\nOriginal'
  )
  state.assets.open()
  const pending = state.assets.download()
  state.draft.value.text = 'Fresh text with no image'
  finish?.({
    status: 'stored',
    url: '/api/notes/assets/a.png',
    bytes: 20,
    format: 'png'
  })
  await pending
  assert.equal(state.draft.value.text, 'Fresh text with no image')
  assert.equal(state.assets.replacements.value, 0)
  state.scope.stop()
})
test('user cancellation keeps completed downloads but conflict discards the pending batch', async () => {
  for (const conflict of [true, false]) {
    let abortPending: (() => void) | undefined
    const state = setup(async (input, signal) => {
      if (input.kind === 'image') {
        return {
          status: 'stored',
          url: '/api/notes/assets/a.png',
          bytes: 20,
          format: 'png'
        }
      }
      return new Promise((_resolve, reject) => {
        abortPending = () => reject(new Error('aborted'))
        signal?.addEventListener('abort', abortPending, { once: true })
      })
    })
    state.assets.open()
    const pending = state.assets.download()
    await new Promise(resolve => setImmediate(resolve))
    if (conflict) {
      state.draft.value.status = 'conflict'
    } else {
      state.assets.close()
    }
    await pending
    assert.equal(state.changes, conflict ? 0 : 1)
    state.scope.stop()
  }
})

const images = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `![](https://example.com/${i}.png)`
  ).join('\n\n')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('an image row needs one request and learns its size from the preview', async () => {
  let heads = 0
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    images(1),
    {
      inspectExternalAsset: async () => {
        heads++
        return { size: null }
      },
      previewExternalAsset: async () => new Blob(['12345'])
    }
  )
  state.assets.open()
  const row = state.assets.rows.value[0]!
  await state.assets.inspect(row)
  assert.equal(heads, 0)
  assert.equal(row.size, 5)
  assert.ok(row.preview.startsWith('blob:'))
  state.scope.stop()
})

test('a PDF row still reads its size with a HEAD request', async () => {
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    '[P](https://example.com/b.pdf)',
    {
      inspectExternalAsset: async () => ({ size: 42 })
    }
  )
  state.assets.open()
  await state.assets.inspect(state.assets.rows.value[0]!)
  assert.equal(state.assets.rows.value[0]!.size, 42)
  state.scope.stop()
})

test('at most three preview requests run at the same time', async () => {
  let running = 0
  let peak = 0
  const releases: Array<() => void> = []
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    images(8),
    {
      previewExternalAsset: async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise<void>(resolve => releases.push(resolve))
        running--
        return new Blob(['x'])
      }
    }
  )
  state.assets.open()
  const all = state.assets.rows.value.map(row => state.assets.inspect(row))
  await tick()
  assert.equal(running, 3)
  while (releases.length) {
    releases.shift()!()
    await tick()
  }
  await Promise.all(all)
  assert.equal(peak, 3)
  state.scope.stop()
})

test('previews over the byte budget are evicted, revoked and load again on return', async () => {
  const big = new Blob([new Uint8Array(60_000_000)])
  const revoked: string[] = []
  const revoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
    revoke(url)
  }
  let loads = 0
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    images(2),
    {
      previewExternalAsset: async () => {
        loads++
        return big
      }
    }
  )
  try {
    state.assets.open()
    const [first, second] = state.assets.rows.value as [
      (typeof state.assets.rows.value)[number],
      (typeof state.assets.rows.value)[number]
    ]
    await state.assets.inspect(first)
    const firstUrl = first.preview
    await state.assets.inspect(second)
    assert.equal(first.preview, '')
    assert.deepEqual(revoked, [firstUrl])
    assert.ok(second.preview.startsWith('blob:'))
    await state.assets.inspect(first)
    assert.equal(loads, 3)
    assert.equal(second.preview, '')
  } finally {
    state.scope.stop()
    URL.revokeObjectURL = revoke
  }
})

test('a failed preview shows an error state and loads again on the next visit', async () => {
  let fail = true
  const state = setup(
    async () => ({ status: 'rejected', reason: 'file-too-large' }),
    images(1),
    {
      previewExternalAsset: async () => {
        if (fail) throw new Error('queue full')
        return new Blob(['ok'])
      }
    }
  )
  state.assets.open()
  const row = state.assets.rows.value[0]!
  await state.assets.inspect(row)
  assert.equal(row.previewState, 'error')
  fail = false
  await state.assets.inspect(row)
  assert.equal(row.previewState, 'idle')
  assert.ok(row.preview.startsWith('blob:'))
  state.scope.stop()
})
