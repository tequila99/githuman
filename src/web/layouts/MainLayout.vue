<script setup lang="ts">
import WindowHost from '@/components/windows/WindowHost.vue'
import { storeToRefs } from 'pinia'
import {
  onMounted,
  onUnmounted,
  useTemplateRef,
  nextTick,
  watch,
  ref,
  computed
} from 'vue'
import type { QPageContainer } from 'quasar'
import { registerPageElement } from '@/utils/windows/window-elements'
import { useRepositoryStore } from '@/stores/repository-store'
import { useServerEvents } from '@/composables/use-server-events'
import { useAgentStore } from '@/stores/agent-store'
import { useNavDrawer } from '@/composables/use-nav-drawer'
import AgentSidebar from '@/components/agent/AgentSidebar.vue'
import MainHeader from '@/components/MainHeader.vue'
import MainMenu from '@/components/MainMenu.vue'
import DeviceRequestDialog from '@/components/devices/DeviceRequestDialog.vue'
import { useAccessStore } from '@/stores/access-store'
import { useWorkspaceCoordinator } from '@/composables/use-workspace-coordinator'
import WorkspaceFooter from '@/components/WorkspaceFooter.vue'
import { useVisibleViewport } from '@/composables/use-visible-viewport'
import { useBodyClass } from '@/composables/use-body-class'
import { provideNarrowWorkspace } from '@/composables/use-row-height'

const page = useTemplateRef<QPageContainer>('page')
const workspace = useWorkspaceCoordinator()
provideNarrowWorkspace(() => workspace.narrow.value)
useBodyClass('workspace-narrow', workspace.narrow)
const headerHeight = ref(50)
const footerHeight = ref(64)
const viewport = useVisibleViewport()
// In the narrow layout the agent pane or a window covers the page; both stay mounted.
const pageHidden = computed(
  () =>
    workspace.narrow.value &&
    (workspace.pane.value === 'agent' || Boolean(workspace.window.value))
)
const agentShown = computed(
  () =>
    workspace.narrow.value &&
    workspace.pane.value === 'agent' &&
    !workspace.window.value
)
watch([workspace.pane, workspace.window], async () => {
  if (!workspace.narrow.value) return
  await nextTick()
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
  const target = workspace.window.value
    ? document.querySelector<HTMLElement>(
        `[data-window-id="${workspace.window.value}"]`
      )
    : workspace.pane.value === 'agent'
      ? document.getElementById('workspace-agent')
      : page.value?.$el
  target?.focus({ preventScroll: true })
})
let unregisterPage: (() => void) | undefined
onMounted(() => {
  if (page.value) unregisterPage = registerPageElement(page.value.$el)
})
onUnmounted(() => unregisterPage?.())

const repositoryStore = useRepositoryStore()
const repositoryEvents = useServerEvents(['files:changed'], () => {
  void repositoryStore.fetchInfo()
})
onUnmounted(repositoryEvents.close)

const { enabled: agentEnabled } = storeToRefs(useAgentStore())
// Only this machine answers pairing requests (ADR 0079).
const { isLocal } = storeToRefs(useAccessStore())
const {
  open: leftDrawerOpen,
  toggle: toggleLeftDrawer,
  onResize
} = useNavDrawer()
</script>

<template>
  <q-layout
    view="hHh lpr fFf"
    :class="{
      'workspace--narrow': workspace.narrow.value,
      'workspace--short': viewport.metrics.height < 360
    }"
    @resize="onResize"
  >
    <WindowHost />
    <MainHeader
      v-show="!workspace.window.value"
      @resize="height => (headerHeight = height)"
      @toggle-drawer="toggleLeftDrawer"
    />
    <MainMenu v-model="leftDrawerOpen" />
    <AgentSidebar v-if="agentEnabled" />
    <DeviceRequestDialog v-if="isLocal" />
    <WorkspaceFooter
      v-if="
        workspace.narrow.value &&
        !workspace.window.value &&
        !viewport.keyboardOpen
      "
      @resize="height => (footerHeight = height)"
    />

    <q-page-container
      ref="page"
      tabindex="-1"
      :inert="pageHidden"
      :aria-hidden="pageHidden"
      :style="pageHidden ? { visibility: 'hidden' } : undefined"
    >
      <router-view />
    </q-page-container>
    <aside
      id="workspace-agent"
      tabindex="-1"
      :inert="!agentShown"
      :aria-hidden="!agentShown"
      class="workspace-agent"
      :style="{
        visibility: agentShown ? 'visible' : 'hidden',
        top: `${viewport.metrics.offsetTop + headerHeight}px`,
        height: `${Math.max(0, viewport.metrics.height - headerHeight - (viewport.keyboardOpen ? 0 : footerHeight))}px`
      }"
    />
  </q-layout>
</template>

<style scoped>
.workspace-agent {
  position: fixed;
  left: 0;
  right: 0;
  min-width: 0;
}
</style>
