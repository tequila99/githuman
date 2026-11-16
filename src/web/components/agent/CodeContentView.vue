<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLineTokens } from '@/composables/use-line-tokens'
import { toolTextPreview, TOOL_MAX_PREVIEW_CHARS } from '@/utils/tool-content'
import type { ToolText } from '@/utils/tool-content'
import FileContentLine from '@/components/FileContentLine.vue'
import CopyButton from '@/components/buttons/CopyButton.vue'
import TextButton from '@/components/buttons/TextButton.vue'

const props = defineProps<{ content: ToolText }>()
const { t } = useI18n()
const wrap = shallowRef(true)
const step = shallowRef(1)
const preview = computed(() => toolTextPreview(props.content.text, step.value))
const lines = computed(() => preview.value.text.split('\n'))
const document = computed(() => ({
  lines: props.content.text.slice(0, TOOL_MAX_PREVIEW_CHARS).split('\n')
}))
const highlightSource = computed(() =>
  props.content.json && props.content.text.length <= TOOL_MAX_PREVIEW_CHARS
    ? {
        key: document.value,
        path: 'tool.json',
        lines: () => document.value.lines
      }
    : null
)
const { tokens } = useLineTokens(highlightSource, true)
watch(
  () => props.content.text,
  () => {
    step.value = 1
  }
)
</script>

<template>
  <div class="code-content">
    <div class="row items-center q-gutter-xs code-content__toolbar">
      <span class="text-caption text-grey">{{
        content.json ? 'JSON' : t('toolContent.text')
      }}</span>
      <q-space />
      <q-btn
        flat
        dense
        no-caps
        size="sm"
        :label="t('toolContent.wrap')"
        :aria-pressed="wrap"
        :color="wrap ? 'primary' : undefined"
        @click="wrap = !wrap"
      />
      <CopyButton :value="content.text" :tooltip="t('toolContent.copy')" />
    </div>
    <div v-if="content.limited" class="text-caption text-grey q-pa-xs">{{
      t('toolContent.formatLimited')
    }}</div>
    <div
      class="code-content__scroll"
      tabindex="0"
      :aria-label="t('toolContent.body')"
    >
      <FileContentLine
        v-for="(line, index) in lines"
        :key="index"
        :line-number="index + 1"
        :content="line"
        :tokens="line === document.lines[index] ? tokens?.[index] : null"
        :wrap="wrap"
      />
    </div>
    <div
      v-if="preview.hidden"
      class="row items-center q-pa-xs text-caption text-grey"
    >
      <span>{{ t('toolContent.previewLimited') }}</span>
      <TextButton
        v-if="preview.canExpand"
        :label="t('toolContent.more')"
        @click="step++"
      />
    </div>
  </div>
</template>

<style scoped>
.code-content {
  min-width: 0;
  border: 1px solid var(--app-border-color, #8884);
  border-radius: 4px;
}
.code-content__toolbar {
  padding: 2px 8px;
  border-bottom: 1px solid var(--app-border-color, #8884);
}
.code-content__scroll {
  max-height: 360px;
  overflow: auto;
}
.code-content__scroll :deep(.file-content-line) {
  font-size: 12px;
}
.code-content__scroll :deep(.file-content-line__gutter) {
  width: 40px;
}
</style>
