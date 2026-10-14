<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NoteDescriptor } from '../../../shared/notes/types.ts'
defineProps<{ descriptor: NoteDescriptor }>()
const emit = defineEmits<{ select: [path: string] }>()
const { t } = useI18n()
</script>
<template>
  <section class="col q-pa-lg">
    <div class="text-h6">{{ descriptor.note.path }}</div>
    <p class="text-grey q-mt-md">{{
      t(
        descriptor.note.presence === 'deleted'
          ? 'notes.deletedNote'
          : 'notes.absentNote'
      )
    }}</p>
    <div v-if="descriptor.backlinks.length" class="q-mt-lg">
      <div class="text-subtitle2">{{ t('notes.backlinks') }}</div>
      <q-list dense>
        <q-item
          v-for="note in descriptor.backlinks"
          :key="note.id"
          clickable
          @click="emit('select', note.path)"
        >
          <q-item-section>{{ note.path }}</q-item-section>
        </q-item>
      </q-list>
    </div>
  </section>
</template>
