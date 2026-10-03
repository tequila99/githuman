<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { attachmentSrc, type AttachmentItem } from '@/utils/attachments'
const props = defineProps<{ item: AttachmentItem }>()
const emit = defineEmits<{ remove: [] }>()
const { t } = useI18n()
const src = computed(() => attachmentSrc(props.item))
</script>
<template>
  <div class="agent-attachment-thumb">
    <q-img
      :src="src"
      :alt="item.name"
      fit="cover"
      class="fit rounded-borders"
    />
    <q-btn
      round
      dense
      unelevated
      size="xs"
      color="grey-8"
      icon="close"
      class="agent-attachment-thumb-remove"
      :aria-label="t('agent.context.remove')"
      @click="emit('remove')"
    />
  </div>
</template>
<style scoped>
.agent-attachment-thumb {
  position: relative;
  width: 56px;
  height: 56px;
}
.agent-attachment-thumb-remove {
  position: absolute;
  top: -6px;
  right: -6px;
}
</style>
