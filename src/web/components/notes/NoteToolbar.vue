<script setup lang="ts">
import { computed } from 'vue'
import { useAgentStore } from '@/stores/agent-store'
import { ADD_TO_CHAT_ICON } from '@/utils/agent-icon'
import { useI18n } from 'vue-i18n'
import { useAddNoteToAgent } from '@/composables/notes/use-add-note-to-agent'
import type { NoteDraft } from '@/stores/notes-store'
import type { NoteEditorMode } from '@/composables/notes/use-note-editor'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const props = defineProps<{
  path: string
  status: NoteDraft['status']
  visualDisabled: boolean
}>()
const mode = defineModel<NoteEditorMode>({ required: true })
const emit = defineEmits<{ insertLink: []; downloadAssets: [] }>()
const { t } = useI18n()
const addToAgent = useAddNoteToAgent()
const agent = useAgentStore()
const modes = computed(() => [
  {
    value: 'visual' as const,
    icon: 'edit',
    label: t('notes.visual'),
    disabled: props.visualDisabled
  },
  {
    value: 'source' as const,
    icon: 'code',
    label: t('notes.source'),
    disabled: false
  }
])
</script>
<template>
  <div class="note-toolbar row items-center q-pa-md q-gutter-sm">
    <span class="col ellipsis">{{ path }}</span>
    <span
      role="status"
      :class="
        status === 'error' || status === 'conflict'
          ? 'text-negative'
          : 'text-grey'
      "
      >{{ t('notes.status.' + status) }}</span
    >
    <q-btn
      v-if="agent.enabled"
      flat
      round
      dense
      color="grey-7"
      :icon="ADD_TO_CHAT_ICON"
      :aria-label="t('notes.addToAgent')"
      @click="addToAgent(path)"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('notes.addToAgent')
      }}</q-tooltip>
    </q-btn>
    <q-btn
      flat
      round
      dense
      icon="download"
      :disable="status === 'conflict'"
      :aria-label="t('notes.externalAssets.title')"
      @click="emit('downloadAssets')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS"
        >{{ t('notes.externalAssets.title') }} (Ctrl+Shift+D)</q-tooltip
      >
    </q-btn>
    <div
      class="note-modes row no-wrap"
      role="group"
      :aria-label="t('notes.source')"
    >
      <q-btn
        v-for="option in modes"
        :key="option.value"
        :data-mode-button="option.value"
        flat
        dense
        class="note-action"
        :class="{ 'note-action-active': mode === option.value }"
        :icon="option.icon"
        :aria-label="option.label"
        :aria-pressed="mode === option.value"
        :disable="option.disabled"
        @click="mode = option.value"
      >
        <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ option.label }}</q-tooltip>
      </q-btn>
    </div>
    <q-btn
      flat
      dense
      class="note-action"
      icon="link"
      :aria-label="t('notes.insertLink')"
      @mousedown.prevent
      @click="emit('insertLink')"
      ><q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('notes.insertLink')
      }}</q-tooltip></q-btn
    >
  </div>
</template>
