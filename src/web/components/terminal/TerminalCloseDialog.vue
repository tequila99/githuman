<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ all?: boolean }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()
</script>
<template>
  <q-dialog v-model="open">
    <q-card style="min-width: 320px">
      <q-card-section class="text-h6">{{
        t(all ? 'terminal.closeAllTitle' : 'terminal.closeTitle')
      }}</q-card-section>
      <q-card-section>{{
        t(all ? 'terminal.closeAllMessage' : 'terminal.closeMessage')
      }}</q-card-section>
      <q-card-actions align="right">
        <q-btn v-close-popup flat :label="t('terminal.cancel')" />
        <q-btn
          v-close-popup
          flat
          color="negative"
          :label="t(all ? 'terminal.closeAll' : 'terminal.closeTab')"
          @click="emit('confirm')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
