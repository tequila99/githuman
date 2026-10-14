<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NoteDraft } from '@/stores/notes-store'

const props = defineProps<{
  draft: NoteDraft
  editorError: string
  visualUnsupported: boolean
}>()
const emit = defineEmits<{ save: []; reload: []; copy: [] }>()
const { t } = useI18n()
const saveFailed = computed(
  () => props.draft.status === 'error' || props.draft.status === 'conflict'
)
</script>
<template>
  <q-banner
    dense
    v-if="editorError"
    class="note-banner bg-negative text-white q-mx-md"
    >{{ editorError }}</q-banner
  >
  <q-banner
    v-if="visualUnsupported"
    dense
    class="note-banner bg-orange-1 text-dark q-mx-md"
    >{{ t('notes.unsupported') }}</q-banner
  >
  <q-banner
    dense
    v-if="saveFailed"
    class="note-banner q-ma-md bg-orange-1 text-dark"
  >
    {{ draft.error }}
    <template #action
      ><q-btn
        v-if="draft.status === 'error'"
        flat
        :label="t('notes.retry')"
        @click="emit('save')" /><q-btn
        flat
        :label="t('notes.loadDisk')"
        @click="emit('reload')" /><q-btn
        flat
        :label="t('notes.saveCopy')"
        @click="emit('copy')"
    /></template>
    <details v-if="draft.status === 'conflict'"
      ><summary>{{ t('notes.compare') }}</summary
      ><div class="row q-col-gutter-md"
        ><div class="col"
          ><b>{{ t('notes.draft') }}</b
          ><pre class="note-comparison">{{ draft.text }}</pre></div
        ><div class="col"
          ><b>{{ t('notes.disk') }}</b
          ><pre class="note-comparison">{{
            draft.disk?.text ?? t('notes.missing')
          }}</pre>
        </div></div
      ></details
    >
  </q-banner>
</template>
<style scoped>
.note-comparison {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
}
</style>
