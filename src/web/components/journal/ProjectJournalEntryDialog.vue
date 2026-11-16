<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { JournalSearchEntry } from '@/api/types'
import JournalEntryDialog from './JournalEntryDialog.vue'

const entry = defineModel<JournalSearchEntry | null>({ required: true })
const { t } = useI18n()
const detailOpen = computed({
  get: () => entry.value !== null,
  set: value => {
    if (!value) entry.value = null
  }
})
</script>

<template>
  <JournalEntryDialog
    v-model="detailOpen"
    :entry="entry"
    :superseded="entry?.isSuperseded ?? false"
  >
    <template v-if="entry" #task>
      <router-link
        v-if="entry.taskId !== null && entry.taskTitle !== null"
        class="project-journal__task"
        :to="{
          name: 'task',
          params: { id: entry.taskId },
          query: {
            storeId: entry.storeId,
            tab: 'journal',
            uiPane: 'content'
          }
        }"
        @click="detailOpen = false"
        >{{ entry.taskTitle }}</router-link
      >
      <span v-else-if="entry.taskId === null">{{
        t('journal.project.noTask')
      }}</span>
    </template>
  </JournalEntryDialog>
</template>

<style scoped>
.project-journal__task {
  display: block;
  color: var(--q-primary);
  overflow-wrap: anywhere;
}
</style>
