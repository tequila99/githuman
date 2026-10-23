import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter, createMemoryHistory } from 'vue-router'
import { enqueueWorkspaceNavigation } from '@/composables/use-workspace-navigation'

test('nested intents deduplicate after the real router commits and rejected guards retain the route', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: {} }]
  })
  await router.push('/')
  let committed = 0
  router.afterEach((_to, _from, failure) => {
    if (!failure) committed++
  })
  await Promise.all([
    enqueueWorkspaceNavigation(router, () => ({ query: { uiPane: 'agent' } })),
    enqueueWorkspaceNavigation(router, () => ({ query: { uiPane: 'agent' } }))
  ])
  assert.equal(committed, 1)
  router.beforeEach(to => to.query.uiPane !== 'content')
  await enqueueWorkspaceNavigation(router, () => ({
    query: { uiPane: 'content' }
  }))
  assert.equal(router.currentRoute.value.query.uiPane, 'agent')
  assert.equal(committed, 1)
})
