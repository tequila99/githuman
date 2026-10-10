import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ref, computed, defineComponent } from 'vue'
import { createApplicationRegistry } from '@/stores/windows/application-registry'

test('a new widget registers with reactive metadata without changing the dock', () => {
  const registry = createApplicationRegistry()
  const count = ref(0)
  const dispose = registry.register({
    id: 'clock',
    component: defineComponent({}),
    title: () => 'Clock',
    icon: 'schedule',
    availability: () => ({ enabled: true }),
    badge: () => count.value || null,
    active: () => false,
    activate: () => {
      count.value++
    }
  })
  const badge = computed(() => registry.applications.value[0]?.badge())
  assert.equal(badge.value, null)
  registry.applications.value[0]?.activate()
  assert.equal(badge.value, 1)
  assert.throws(
    () => registry.register(registry.applications.value[0]!),
    /already registered/
  )
  dispose()
  assert.equal(registry.applications.value.length, 0)
})

test('a dock-only application restores versioned data independently from other applications', async () => {
  const { setStorageBackend } = await import('@/utils/safe-storage')
  const saved = new Map<string, string>([
    ['githuman:application:widget', JSON.stringify({ version: 2, data: 4 })]
  ])
  setStorageBackend({
    getItem: key => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  })
  try {
    const registry = createApplicationRegistry()
    const count = ref(0)
    const dispose = registry.register({
      id: 'widget',
      title: () => 'Widget',
      icon: 'schedule',
      availability: () => ({ enabled: true }),
      badge: () => count.value,
      active: () => false,
      activate: () => {
        count.value++
      },
      persistence: {
        version: 2,
        serialize: () => count.value,
        restore: (data, version) => {
          if (version === 2 && typeof data === 'number') count.value = data
        }
      }
    })
    assert.equal(count.value, 4)
    assert.equal(registry.applications.value[0]?.component, undefined)
    registry.applications.value[0]?.activate()
    const { nextTick } = await import('vue')
    await nextTick()
    assert.deepEqual(JSON.parse(saved.get('githuman:application:widget')!), {
      version: 2,
      data: 5
    })
    dispose()
  } finally {
    setStorageBackend(null)
  }
})
