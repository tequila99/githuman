<script setup lang="ts">
import { ref } from 'vue'
import MainHeader from '@/components/MainHeader.vue'
import MainMenu from '@/components/MainMenu.vue'

const leftDrawerOpen = ref(false)

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value
}
</script>

<template>
  <q-layout view="hHh lpr fFf">
    <MainHeader @toggle-drawer="toggleLeftDrawer" />
    <MainMenu v-model="leftDrawerOpen" />

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
