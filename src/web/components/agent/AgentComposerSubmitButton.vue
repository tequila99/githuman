<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AgentChatEntry } from '@/utils/agent-chat'
defineProps<{ status: AgentChatEntry['chat']['status']; isEmpty: boolean }>()
const emit = defineEmits<{ send: []; cancel: [] }>()
const { t } = useI18n()
</script>
<template>
  <q-btn
    v-if="status === 'busy'"
    round
    dense
    flat
    size="sm"
    color="negative"
    icon="stop_circle"
    class="q-ma-xs"
    :aria-label="t('agent.cancel')"
    @click="emit('cancel')"
  />
  <q-btn
    v-else
    round
    dense
    flat
    size="sm"
    color="primary"
    icon="send"
    class="q-ma-xs"
    :disable="status !== 'ready' || isEmpty"
    :aria-label="t('agent.send')"
    @click="emit('send')"
  />
</template>
