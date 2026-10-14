<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ path: string; folder: boolean }>()
const emit = defineEmits<{ rename: [path: string, folder: boolean] }>()
const { t } = useI18n()
</script>
<template>
  <q-menu context-menu touch-position>
    <q-list dense style="min-width: 160px">
      <q-item clickable v-close-popup @click="emit('rename', path, folder)">
        <q-item-section avatar><q-icon name="edit" /></q-item-section>
        <q-item-section>{{ t('notes.rename') }}</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
</template>
