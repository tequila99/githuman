<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useJournalRows } from '@/composables/tasks/use-journal-rows'
import ProjectJournalToolbar from '@/components/journal/ProjectJournalToolbar.vue'
import ProjectJournalEntryDialog from '@/components/journal/ProjectJournalEntryDialog.vue'
import AppPage from '@/components/AppPage.vue'
import VirtualInfiniteList from '@/components/VirtualInfiniteList.vue'
import JournalListItem from '@/components/journal/JournalListItem.vue'
import type { JournalSearchEntry } from '@/api/types'
import LoadErrorBanner from '@/components/LoadErrorBanner.vue'
import { useProjectJournal } from '@/composables/tasks/use-project-journal'
import {
  enqueueWorkspaceNavigation,
  useWorkspaceNavigation
} from '@/composables/use-workspace-navigation'
import {
  journalFilterQuery,
  journalRouteState,
  type JournalFilters
} from '@/utils/journal-navigation'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceNavigation()
const state = computed(() => journalRouteState(route.query))
const grouped = computed(() => route.query.group === 'task')
const searchKey = computed(() =>
  JSON.stringify([state.value.input, grouped.value])
)
const selectedEntry = shallowRef<JournalSearchEntry | null>(null)
const visible = computed(
  () =>
    !workspace.narrow.value ||
    (!workspace.window.value && workspace.pane.value === 'list')
)
const journal = useProjectJournal(
  () => state.value.input,
  () => visible.value
)
const { items, storeId, nextBefore, loading, error, hasUpdates, loaded } =
  journal
const rows = useJournalRows(items, grouped, () => t('journal.project.noTask'))
function toggleGrouping() {
  void enqueueWorkspaceNavigation(router, () => ({
    query: { ...route.query, group: grouped.value ? undefined : 'task' }
  }))
}
function search(value: string | null | undefined) {
  void enqueueWorkspaceNavigation(router, () => ({
    query: { ...route.query, q: value || undefined }
  }))
}
function apply(filters: JournalFilters) {
  void enqueueWorkspaceNavigation(router, () => ({
    query: journalFilterQuery(route.query, filters)
  }))
}
</script>
<template>
  <AppPage>
    <section class="project-journal column no-wrap fit">
      <ProjectJournalToolbar
        :text="state.text"
        :filters="state.filters"
        :grouped="grouped"
        :loading="loading"
        :has-updates="hasUpdates"
        :agent-names="journal.agentNames.value"
        :models="journal.models.value"
        :store-id="storeId"
        @search="search"
        @apply="apply"
        @toggle-grouping="toggleGrouping"
        @refresh="journal.refresh"
      />
      <q-linear-progress v-if="loading" indeterminate />
      <q-separator />
      <div v-if="error" class="q-pa-sm">
        <LoadErrorBanner
          v-if="error"
          :title="t('journal.error')"
          :message="error"
          :loading="loading"
          @retry="journal.retry"
        />
      </div>
      <VirtualInfiniteList
        class="col"
        :items="rows"
        :loading="loading"
        :has-more="nextBefore !== null"
        :disabled="Boolean(error) || !visible"
        :reset-key="searchKey"
        :load-more="journal.older"
      >
        <template #default="{ item: row }">
          <q-item-label
            v-if="row.kind === 'group'"
            :key="row.key"
            header
            class="project-journal__group"
            >{{ row.label }}</q-item-label
          >
          <JournalListItem
            v-else
            :key="row.key"
            :entry="row.entry"
            :task="row.entry"
            :superseded="row.entry.isSuperseded"
            @click="selectedEntry = row.entry"
          />
        </template>
        <template #empty>
          <p v-if="loaded && !error" class="q-pa-md text-grey">{{
            t('journal.project.empty')
          }}</p>
        </template>
      </VirtualInfiniteList>
      <ProjectJournalEntryDialog v-model="selectedEntry" />
    </section>
  </AppPage>
</template>
<style scoped>
.project-journal {
  min-width: 0;
}
.project-journal__group {
  overflow-wrap: anywhere;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: inherit;
  border-bottom: 1px solid var(--app-divider);
  background-color: rgba(128, 128, 128, 0.12);
}
</style>
