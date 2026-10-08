import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { useFullFileVersion } from '@/composables/use-full-file-version'

function setup() {
  const lines = shallowRef<string[]>([])
  const isBinary = ref(false),
    loaded = ref(false),
    error = ref<string | null>(null),
    deleted = ref(false)
  const scope = effectScope()
  const version = scope.run(() =>
    useFullFileVersion({ lines, isBinary, loaded, error, deleted })
  )!
  return {
    lines,
    isBinary,
    loaded,
    error,
    deleted,
    version,
    read: () => version.value,
    scope
  }
}

test('first failure has no successful version; cached/loaded text acquires one', async () => {
  const s = setup()
  try {
    assert.equal(s.version.value, null)
    s.error.value = 'first load failed'
    await nextTick()
    assert.equal(s.version.value, null)
    s.lines.value = ['cached text']
    s.loaded.value = true
    s.error.value = null
    await nextTick()
    assert.equal(s.read()?.kind, 'text')
    assert.equal(s.read()?.lines, s.lines.value)
  } finally {
    s.scope.stop()
  }
})

test('refetch error and recovery with the same text preserve successful identity', async () => {
  const s = setup()
  try {
    s.lines.value = ['long text']
    s.loaded.value = true
    await nextTick()
    const first = s.version.value
    s.error.value = 'refetch failed'
    await nextTick()
    assert.equal(s.version.value, first)
    s.error.value = null
    await nextTick()
    assert.equal(s.version.value, first)
    s.lines.value = ['short']
    await nextTick()
    assert.notEqual(s.version.value, first)
    assert.equal(s.read()?.lines, s.lines.value)
  } finally {
    s.scope.stop()
  }
})

test('binary, empty and deletion are distinct successful display versions', async () => {
  const s = setup()
  try {
    s.loaded.value = true
    await nextTick()
    assert.equal(s.read()?.kind, 'empty')
    s.isBinary.value = true
    await nextTick()
    assert.equal(s.read()?.kind, 'binary')
    s.deleted.value = true
    await nextTick()
    assert.equal(s.read()?.kind, 'deleted')
  } finally {
    s.scope.stop()
  }
})
