<script setup lang="ts">
import { defineAsyncComponent, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { openURL } from 'quasar'
import MarkdownContent from '@/components/MarkdownContent.vue'
import type { EditorLinkSource, EditorLinkTarget } from '@/utils/editor-links'
import EditorLinkPicker from './EditorLinkPicker.vue'

const MarkdownVisualEditor = defineAsyncComponent(
  () => import('./MarkdownVisualEditor.vue')
)

const props = defineProps<{
  /** Current Markdown. A parent that replaces the text from outside changes the component key. */
  modelValue: string
  source: EditorLinkSource
  readonly?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [text: string]
  /** An internal link was clicked; the owner decides where it leads. */
  follow: [href: string]
}>()
const { t } = useI18n()
const pickerOpen = shallowRef(false)
// The visual editor cannot hold every Markdown text; such text stays read-only.
const unsupported = shallowRef(false)
const visual = useTemplateRef('visual')

function change(text: string) {
  if (text !== props.modelValue) emit('update:modelValue', text)
}
function insert(target: EditorLinkTarget) {
  visual.value?.insertTarget(target)
}
function follow(event: MouseEvent) {
  if (event.type === 'auxclick' && event.button !== 1) return
  const anchor =
    event.target instanceof Element ? event.target.closest('a') : null
  const href = anchor?.getAttribute('href')
  if (!href) return
  event.preventDefault()
  event.stopPropagation()
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    openURL(href, undefined, { noopener: true, noreferrer: true })
  } else if (!/^[a-z][a-z\d+.-]*:/i.test(href)) {
    emit('follow', href)
  }
}
</script>
<template>
  <section class="markdown-editor column no-wrap">
    <q-banner v-if="unsupported" dense class="bg-warning text-black q-mb-sm">{{
      t('markdown.unsupported')
    }}</q-banner>
    <div @click.capture="follow" @auxclick.capture="follow">
      <MarkdownContent
        v-if="readonly || unsupported"
        variant="document"
        :text="modelValue"
      />
      <MarkdownVisualEditor
        v-else
        ref="visual"
        :text="modelValue"
        :source="source"
        @change="change"
        @unsupported="unsupported = true"
        @link="pickerOpen = true"
      />
    </div>
    <EditorLinkPicker v-model="pickerOpen" :source="source" @select="insert" />
  </section>
</template>

<style scoped>
/* Keep room for the block controls without Crepe's document-sized margins. */
.markdown-editor :deep(.note-visual .milkdown .ProseMirror) {
  padding: 12px 16px 24px 72px;
}
.markdown-editor :deep(.note-visual .milkdown .ProseMirror > :first-child) {
  margin-top: 0;
}
</style>
