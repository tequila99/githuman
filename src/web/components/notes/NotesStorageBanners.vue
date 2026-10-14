<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ error: string; warning: string | null }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>
<template>
  <q-banner v-if="error" dense class="note-banner bg-negative text-white">
    {{ error }}
    <template #action
      ><q-btn flat :label="t('notes.retry')" @click="emit('retry')"
    /></template>
  </q-banner>
  <q-banner v-if="warning" dense class="note-banner bg-orange-1 text-dark">{{
    warning
  }}</q-banner>
</template>
