<script setup lang="ts">
import type { AgentContextItem } from '@/api/types'
import { isImageAttachment } from '@/utils/attachments'
import AgentAttachmentThumbnail from './AgentAttachmentThumbnail.vue'
import AgentContextChip from './AgentContextChip.vue'
defineProps<{ items: AgentContextItem[] }>()
const emit = defineEmits<{ remove: [index: number] }>()
</script>
<template>
  <div v-if="items.length > 0" class="row items-center q-gutter-xs q-pa-xs">
    <template v-for="(item, i) in items" :key="i">
      <AgentAttachmentThumbnail
        v-if="isImageAttachment(item)"
        :item="item"
        @remove="emit('remove', i)"
      />
      <AgentContextChip
        v-else
        removable
        color="primary"
        text-color="white"
        :item="item"
        @remove="emit('remove', i)"
      />
    </template>
  </div>
</template>
