<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useAgentStore } from '@/stores/agent-store'
import { useNavDrawer } from '@/composables/use-nav-drawer'
import AgentSidebar from '@/components/agent/AgentSidebar.vue'
import MainHeader from '@/components/MainHeader.vue'
import MainMenu from '@/components/MainMenu.vue'

const { enabled: agentEnabled } = storeToRefs(useAgentStore())
const {
  open: leftDrawerOpen,
  toggle: toggleLeftDrawer,
  onResize
} = useNavDrawer()
</script>

<template>
  <q-layout view="hHh lpr fFf" @resize="onResize">
    <MainHeader @toggle-drawer="toggleLeftDrawer" />
    <MainMenu v-model="leftDrawerOpen" />
    <AgentSidebar v-if="agentEnabled" />

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
