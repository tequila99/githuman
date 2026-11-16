<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import JournalProvenance from './JournalProvenance.vue'
import CatalogListItem from '@/components/CatalogListItem.vue'
import { useAgentStore } from '@/stores/agent-store'
import type { JournalEntry, JournalSearchEntry } from '@/api/types'
import { actorLabel, journalSummary, journalIcon } from '@/utils/task-journal'
import { formatDateTime } from '@/utils/date'

const props = defineProps<{
  entry: JournalEntry
  task?: Pick<JournalSearchEntry, 'taskTitle'>
  superseded?: boolean
  correctionLabel?: string | undefined
}>()
const { t } = useI18n()
const agent = useAgentStore()
const icon = computed(() => journalIcon(props.entry))
const summary = computed(
  () =>
    journalSummary(props.entry) ||
    (props.entry.eventType
      ? t('journal.events.' + props.entry.eventType)
      : props.entry.body)
)
const author = computed(() => {
  const label = actorLabel(props.entry, id => agent.chats[id]?.info.name)
  return t(label.key, label.params)
})
</script>
<template>
  <CatalogListItem
    :title="summary"
    class="journal-list-item"
    :class="{ 'journal-list-item--superseded': superseded }"
  >
    <template #icon>
      <q-icon :name="icon" size="18px" aria-hidden="true" />
    </template>
    <template #metadata>
      <template v-if="task">
        <router-link
          v-if="entry.taskId !== null && task.taskTitle !== null"
          class="journal-list-item__task ellipsis"
          :title="task.taskTitle"
          :to="{
            name: 'task',
            params: { id: entry.taskId },
            query: { storeId: entry.storeId, tab: 'journal', uiPane: 'content' }
          }"
          @click.stop
          >{{ task.taskTitle }}</router-link
        >
        <span v-else class="journal-list-item__task ellipsis">{{
          entry.taskId ?? t('journal.project.noTask')
        }}</span>
      </template>
      <time :datetime="entry.createdAt">{{
        formatDateTime(entry.createdAt)
      }}</time>
      <span v-if="entry.kind !== 'system'">{{
        t('journal.kinds.' + entry.kind)
      }}</span>
      <span v-if="entry.actor.kind !== 'system'">{{ author }}</span>
      <JournalProvenance :entry="entry" compact />
      <span v-if="superseded">{{ t('journal.superseded') }}</span>
      <span v-if="entry.supersedesEntryId">{{
        correctionLabel ??
        t('journal.correctsId', { id: entry.supersedesEntryId.slice(0, 8) })
      }}</span>
    </template>
    <template v-if="$slots.actions" #side>
      <slot name="actions" />
    </template>
  </CatalogListItem>
</template>
<style scoped>
.journal-list-item :deep(.catalog-list-item__metadata) {
  flex-wrap: wrap;
}
.journal-list-item__task {
  max-width: 35%;
  flex: 0 1 auto;
  color: var(--q-primary);
}
.journal-list-item--superseded :deep(.catalog-list-item__title) {
  opacity: 0.6;
  text-decoration: line-through;
}
</style>
