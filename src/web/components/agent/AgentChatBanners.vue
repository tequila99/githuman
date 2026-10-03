<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  autoApprovesEdits: boolean
  autoApprove: boolean
  reviewStale: boolean
  closed: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'disable-auto-approve': []
}>()

const { t } = useI18n()
</script>

<template>
  <q-banner
    v-if="autoApprovesEdits && !autoApprove"
    dense
    class="bg-warning text-dark agent-chat-banners__banner"
  >
    {{ t('agent.autoApprovesEdits') }}
  </q-banner>
  <q-banner
    v-if="autoApprove"
    dense
    inline-actions
    class="bg-warning text-dark agent-chat-banners__banner"
  >
    {{ t('agent.autoApprove.banner') }}
    <template #action>
      <q-btn
        flat
        dense
        no-caps
        color="blue-10"
        class="text-weight-bold"
        :label="t('agent.autoApprove.turnOff')"
        @click="emit('disable-auto-approve')"
      />
    </template>
  </q-banner>
  <q-banner
    v-if="reviewStale"
    dense
    class="bg-warning text-dark agent-chat-banners__banner"
  >
    {{ t('agent.reviewStale') }}
  </q-banner>
  <q-banner
    v-if="closed"
    dense
    class="bg-grey-7 text-white agent-chat-banners__banner"
  >
    {{ t('agent.sessionClosed') }}
  </q-banner>
  <q-banner
    v-if="error"
    dense
    class="bg-negative text-white agent-chat-banners__banner"
  >
    {{ error }}
  </q-banner>
</template>

<style scoped>
.agent-chat-banners__banner {
  flex: 0 0 auto;
  font-size: 12px;
  overflow-wrap: anywhere;
}
/* Quasar sets its own size on the content and on buttons, so the 12px above never reaches them. */
.agent-chat-banners__banner :deep(.q-banner__content),
.agent-chat-banners__banner :deep(.q-btn) {
  font-size: 12px;
  line-height: 1.35;
}
.agent-chat-banners__banner :deep(.q-banner__actions) {
  align-self: center;
}
</style>
