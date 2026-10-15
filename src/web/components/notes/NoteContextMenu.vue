<script setup lang="ts">
import { useAgentStore } from '@/stores/agent-store'
import { ADD_TO_CHAT_ICON } from '@/utils/agent-icon'
import { useDeleteNote } from '@/composables/notes/use-delete-note'
import { useI18n } from 'vue-i18n'
import { useAddNoteToAgent } from '@/composables/notes/use-add-note-to-agent'
defineProps<{ path: string; folder: boolean }>()
const emit = defineEmits<{ rename: [path: string, folder: boolean] }>()
const { t } = useI18n()
const deleteNote = useDeleteNote()
const addToAgent = useAddNoteToAgent()
const agent = useAgentStore()
</script>
<template>
  <q-menu context-menu touch-position>
    <q-list dense style="min-width: 160px">
      <q-item clickable v-close-popup @click="emit('rename', path, folder)">
        <q-item-section side class="q-pr-sm"
          ><q-icon name="edit" size="xs"
        /></q-item-section>
        <q-item-section>{{ t('notes.rename') }}</q-item-section>
      </q-item>
      <q-item
        v-if="!folder && agent.enabled"
        clickable
        v-close-popup
        @click="addToAgent(path)"
      >
        <q-item-section side class="q-pr-sm"
          ><q-icon :name="ADD_TO_CHAT_ICON" size="xs"
        /></q-item-section>
        <q-item-section>{{ t('notes.addToAgent') }}</q-item-section>
      </q-item>
      <q-item v-if="!folder" clickable v-close-popup @click="deleteNote(path)">
        <q-item-section side class="q-pr-sm"
          ><q-icon name="delete_outline" size="xs"
        /></q-item-section>
        <q-item-section>{{ t('notes.delete') }}</q-item-section>
      </q-item>
    </q-list>
  </q-menu>
</template>
