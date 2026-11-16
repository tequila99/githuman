<script setup lang="ts">
import JournalProvenance from './JournalProvenance.vue'
import { computed, shallowRef, watch } from 'vue'
import ToolContentView from '@/components/agent/ToolContentView.vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import type { JournalEntry } from '@/api/types'
import {
  actorLabel,
  factDetail,
  journalMessage,
  journalSummary
} from '@/utils/task-journal'
import { formatDateTime } from '@/utils/date'

const props = defineProps<{
  entry: JournalEntry
  superseded?: boolean
  correctionLabel?: string | undefined
}>()
const { t } = useI18n()
const agent = useAgentStore()
const expanded = shallowRef(false)
const message = computed(() => journalMessage(props.entry))
watch(
  () => props.entry.id,
  () => {
    expanded.value = false
  }
)
const author = computed(() => {
  const label = actorLabel(props.entry, id => agent.chats[id]?.info.name)
  return t(label.key, label.params)
})
</script>
<template>
  <article
    class="journal-entry q-py-sm"
    :class="{ 'journal-entry--superseded': superseded }"
  >
    <slot name="task" />
    <div class="row items-center q-gutter-xs text-caption text-grey">
      <span>{{ t('journal.kinds.' + entry.kind) }}</span>
      <time :datetime="entry.createdAt">{{
        formatDateTime(entry.createdAt)
      }}</time>
      <span>{{ author }}</span>
      <span v-if="superseded">{{ t('journal.superseded') }}</span>
      <q-space /><slot name="actions" />
    </div>
    <JournalProvenance :entry="entry" />
    <div v-if="entry.supersedesEntryId" class="text-caption">{{
      correctionLabel ??
      t('journal.correctsId', { id: entry.supersedesEntryId.slice(0, 8) })
    }}</div>
    <template v-if="entry.eventType === 'agent_event'">
      <template v-if="message">
        <div class="text-caption text-grey q-mt-sm"
          >message · {{ message.role }}</div
        >
        <MarkdownContent
          :text="message.text"
          disable-images
          class="journal-entry__body journal-entry__body--markdown q-mt-sm"
        />
        <p
          v-if="message.truncated"
          class="text-caption text-warning"
          role="status"
          >{{ t('toolContent.truncated') }}</p
        >
      </template>
      <div v-else class="journal-entry__body q-mt-sm">{{
        journalSummary(entry) || t('journal.events.agent_event')
      }}</div>
      <q-expansion-item
        v-model="expanded"
        dense
        switch-toggle-side
        class="app-icon-expansion journal-entry__data q-mt-sm"
        :label="t(expanded ? 'journal.hideData' : 'journal.showData')"
        :toggle-aria-label="
          t(expanded ? 'journal.hideData' : 'journal.showData')
        "
      >
        <ToolContentView
          v-if="expanded"
          :key="entry.id"
          :source="entry.body"
          kind="journal"
          class="q-mt-sm"
        />
      </q-expansion-item>
    </template>
    <div v-else-if="entry.eventType" class="journal-entry__body"
      >{{ t('journal.events.' + entry.eventType) }}
      <span v-if="factDetail(entry)">{{ factDetail(entry) }}</span></div
    >
    <MarkdownContent
      v-else-if="entry.actor.kind === 'agent'"
      :text="entry.body"
      disable-images
      class="journal-entry__body journal-entry__body--markdown q-mt-sm"
    />
    <div v-else class="journal-entry__body">{{ entry.body }}</div>
    <template v-if="entry.context">
      <section class="q-mt-md">
        <strong>{{ t('journal.context.prompt') }}</strong>
        <div class="journal-entry__body">{{ entry.context.prompt }}</div>
        <div
          v-for="reference in entry.context.references"
          :key="reference"
          class="journal-entry__body text-caption text-grey"
          >{{ reference }}</div
        >
        <p v-if="entry.context.promptTruncated" class="text-warning">{{
          t('journal.context.truncated')
        }}</p>
      </section>
      <section class="q-mt-md">
        <strong>{{ t('journal.context.response') }}</strong>
        <MarkdownContent
          v-if="entry.context.response"
          :text="entry.context.response"
          disable-images
          class="journal-entry__body journal-entry__body--markdown"
        />
        <div v-else class="journal-entry__body">{{
          t('journal.context.noResponse')
        }}</div>
        <p v-if="entry.context.responseTruncated" class="text-warning">{{
          t('journal.context.truncated')
        }}</p>
      </section>
    </template>
    <p
      v-else-if="
        (entry.eventType && entry.eventType !== 'agent_event') ||
        entry.actor.kind === 'agent'
      "
      class="text-grey"
      >{{ t('journal.context.missing') }}</p
    >
  </article>
</template>
<style scoped>
.journal-entry {
  border-bottom: 1px solid var(--app-border-color, #8884);
}
.journal-entry--superseded .journal-entry__body {
  opacity: 0.6;
  text-decoration: line-through;
}
.journal-entry__data {
  border: 1px solid var(--app-divider);
  border-radius: 4px;
}
.journal-entry__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.journal-entry__body--markdown {
  white-space: normal;
}
</style>
