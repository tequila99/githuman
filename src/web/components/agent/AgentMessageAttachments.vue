<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import type { AgentContextItem } from '@/api/types'
import {
  attachmentSrc,
  downloadAttachment,
  isImageAttachment,
  type AttachmentItem
} from '@/utils/attachments'
import AgentContextChip from './AgentContextChip.vue'
import { usePreviewStore } from '@/stores/windows/preview-store'
import type { PreviewSource } from '@/types/windows/preview'

const props = defineProps<{
  context: AgentContextItem[]
  source: PreviewSource
}>()
const { t } = useI18n()
const $q = useQuasar()

// A sent image opens enlarged; any other attachment can be saved again.
const preview = usePreviewStore()
function openImage(image: AttachmentItem) {
  preview.open('image', props.source, {
    title: image.name,
    index: props.context.indexOf(image),
    content: image.data
  })
}

function onContextChip(context: AgentContextItem) {
  if (context.kind !== 'attachment') return
  $q.dialog({
    title: t('agent.attach.downloadTitle'),
    message: t('agent.attach.downloadMessage', { name: context.name }),
    ok: {
      label: t('agent.attach.download'),
      flat: true,
      noCaps: true
    },
    cancel: { label: t('agent.newChat.cancel'), flat: true, noCaps: true }
  }).onOk(() => {
    downloadAttachment(context)
  })
}

const images = computed(() => props.context.filter(isImageAttachment))
// `isImageAttachment` is a type guard, which would make TypeScript drop
// every attachment from this list; non-image ones are still in it.
const otherContext = computed<AgentContextItem[]>(() =>
  props.context.filter(c => !isImageAttachment(c))
)
</script>

<template>
  <div>
    <div v-if="images.length > 0" class="row q-gutter-xs q-mt-xs">
      <div
        v-for="(image, i) in images"
        :key="i"
        class="agent-item__thumb"
        role="button"
        tabindex="0"
        :aria-label="image.name"
        @click="openImage(image)"
        @keydown.enter="openImage(image)"
      >
        <q-img
          :src="attachmentSrc(image)"
          :alt="image.name"
          fit="cover"
          class="fit rounded-borders"
        />
      </div>
    </div>
    <div v-if="otherContext.length > 0" class="row q-gutter-xs q-mt-xs">
      <AgentContextChip
        v-for="(c, i) in otherContext"
        :key="i"
        downloadable
        :item="c"
        @download="onContextChip(c)"
      />
    </div>
  </div>
</template>

<style scoped>
.agent-item__thumb {
  width: 72px;
  height: 72px;
  cursor: zoom-in;
}
</style>
