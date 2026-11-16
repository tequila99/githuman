<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { JournalEntry } from '@/api/types'
import DialogHeader from '@/components/DialogHeader.vue'
import JournalEntryContent from './JournalEntryContent.vue'

const open = defineModel<boolean>({ required: true })
defineProps<{
  entry: JournalEntry | null
  superseded?: boolean
  correctionLabel?: string | undefined
}>()
const { t } = useI18n()
</script>

<template>
  <q-dialog v-model="open">
    <q-card class="journal-entry-dialog">
      <DialogHeader
        :title="t('journal.project.entry')"
        :close-label="t('common.close')"
      />
      <q-card-section
        v-if="entry"
        class="q-pt-none scroll"
        style="max-height: 65vh"
      >
        <JournalEntryContent
          :key="entry.id"
          :entry="entry"
          :superseded="superseded"
          :correction-label="correctionLabel"
        >
          <template #task><slot name="task" /></template>
          <template #actions><slot name="actions" /></template>
        </JournalEntryContent>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.journal-entry-dialog {
  width: 720px;
  max-width: 95vw;
}
</style>
