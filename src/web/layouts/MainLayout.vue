<script setup lang="ts">
import WindowHost from '@/components/windows/WindowHost.vue'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, useTemplateRef } from 'vue'
import type { QPageContainer } from 'quasar'
import { registerPageElement } from '@/utils/windows/window-elements'
import { useRepositoryStore } from '@/stores/repository-store'
import { useServerEvents } from '@/composables/use-server-events'
import { useAgentStore } from '@/stores/agent-store'
import { useNavDrawer } from '@/composables/use-nav-drawer'
import AgentSidebar from '@/components/agent/AgentSidebar.vue'
import MainHeader from '@/components/MainHeader.vue'
import MainMenu from '@/components/MainMenu.vue'

const page = useTemplateRef<QPageContainer>('page')
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
const {
  open: leftDrawerOpen,
  toggle: toggleLeftDrawer,
  onResize
} = useNavDrawer()
</script>

<template>
  <q-layout view="hHh lpr fFf" @resize="onResize">
    <WindowHost />
    <MainHeader @toggle-drawer="toggleLeftDrawer" />
    <MainMenu v-model="leftDrawerOpen" />
    <AgentSidebar v-if="agentEnabled" />

    <q-page-container ref="page" tabindex="-1">
      <router-view />
    </q-page-container>
  </q-layout>
</template>
