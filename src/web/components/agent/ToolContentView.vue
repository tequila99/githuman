<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toolContent } from '@/utils/tool-content'
import type { ToolContentSection } from '@/utils/tool-content'
import CodeContentView from './CodeContentView.vue'

const props = defineProps<{ source: string; kind: 'journal' | 'chat' }>()
const { t } = useI18n()
const content = computed(() => toolContent(props.source, props.kind))
const selected = shallowRef('')
const current = computed(
  () =>
    content.value.sections.find(section => section.id === selected.value) ??
    content.value.sections[0]!
)
watch(
  () => [props.source, props.kind],
  () => {
    selected.value = ''
  }
)
function label(section: ToolContentSection): string {
  return section.label === 'block'
    ? t('toolContent.block', { index: section.index })
    : t('toolContent.' + section.label)
}
</script>

<template>
  <section class="tool-content">
    <div v-if="content.title || content.status" class="text-caption q-mb-xs">
      <strong>{{ content.title }}</strong> {{ content.status }}
    </div>
    <div
      v-if="content.toolCallId"
      class="tool-content__id text-mono text-caption text-grey"
      >{{ content.toolCallId }}</div
    >
    <p
      v-if="content.truncated"
      class="text-caption text-warning q-my-xs"
      role="status"
      >{{ t('toolContent.truncated') }}</p
    >
    <q-tabs
      v-if="content.sections.length > 1"
      :model-value="current.id"
      dense
      no-caps
      align="left"
      class="tool-content__tabs"
      @update:model-value="selected = String($event)"
    >
      <q-tab
        v-for="section in content.sections"
        :key="section.id"
        :name="section.id"
        :label="label(section)"
      />
    </q-tabs>
    <CodeContentView :key="current.id" :content="current" />
  </section>
</template>

<style scoped>
.tool-content {
  min-width: 0;
  max-width: 100%;
}
.tool-content__id {
  overflow-wrap: anywhere;
}
.tool-content__tabs {
  max-width: 100%;
}
</style>
