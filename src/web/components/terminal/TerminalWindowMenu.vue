<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  maximized: boolean
  connected: boolean
  originalColors: boolean
}>()
const emit = defineEmits<{
  toggleOriginalColors: []
  minimize: []
  toggleMaximized: []
  closeAll: []
}>()
const { t } = useI18n()
</script>

<template>
  <q-menu>
    <q-list dense>
      <!-- The menu stays open, so the user sees the new colors. -->
      <q-item clickable @click="emit('toggleOriginalColors')">
        <q-item-section side class="q-pr-xs">
          <q-icon
            size="16px"
            :name="originalColors ? 'check_box' : 'check_box_outline_blank'"
          />
        </q-item-section>
        <q-item-section>{{ t('terminal.originalColors') }}</q-item-section>
      </q-item>
      <q-separator />
      <q-item v-close-popup clickable @click="emit('minimize')">
        <q-item-section>{{ t('terminal.minimize') }}</q-item-section>
      </q-item>
      <q-item v-close-popup clickable @click="emit('toggleMaximized')">
        <q-item-section>{{
          t(maximized ? 'terminal.restore' : 'terminal.maximize')
        }}</q-item-section>
      </q-item>
      <q-item
        v-close-popup
        clickable
        :disable="!connected"
        @click="emit('closeAll')"
      >
        <q-item-section>{{ t('terminal.closeAll') }}</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
</template>
