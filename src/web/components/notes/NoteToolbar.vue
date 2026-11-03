<script setup lang="ts">
import AddToAgentButton from '@/components/buttons/AddToAgentButton.vue'
import {
  mdiCodeTags,
  mdiDownloadOutline,
  mdiLinkVariant,
  mdiPencilOutline
} from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNoteAgentContext } from '@/composables/notes/use-add-note-to-agent'
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
const noteContext = useNoteAgentContext()
const modes = computed(() => [
  {
    value: 'visual' as const,
    icon: mdiPencilOutline,
    label: t('notes.visual'),
    disabled: props.visualDisabled
  },
  {
    value: 'source' as const,
    icon: mdiCodeTags,
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
    <AddToAgentButton
      tooltip
      color="grey-7"
      :label="t('notes.addToAgent')"
      :context="() => noteContext(path)"
    />
    <q-btn
      class="app-icon-control"
      flat
      round
      dense
      :icon="mdiDownloadOutline"
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
        class="app-icon-control note-action"
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
      class="app-icon-control note-action"
      :icon="mdiLinkVariant"
      :aria-label="t('notes.insertLink')"
      @mousedown.prevent
      @click="emit('insertLink')"
      ><q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('notes.insertLink')
      }}</q-tooltip></q-btn
    >
  </div>
</template>
