<script setup lang="ts">
import { computed, shallowRef, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotesStore } from '@/stores/notes-store'
const store = useNotesStore()
const { t } = useI18n()
const busy = shallowRef(false)
const selected = reactive<Record<string, string>>({})
const limit = shallowRef(10)
const options = computed(() =>
  store.index.entries
    .filter(entry => entry.id && !entry.folder)
    .map(entry => ({ label: entry.path, value: entry.id! }))
)
const postponed = shallowRef<string[]>([])
const issues = computed(() =>
  (store.index.issues ?? []).filter(
    issue => !postponed.value.includes(issue.id)
  )
)
const candidates = computed(
  () =>
    new Map(
      store.index.entries
        .filter(entry => entry.id)
        .map(entry => [entry.id, entry.path])
    )
)
async function decide(id: string, restore: boolean, candidateId?: string) {
  busy.value = true
  try {
    await store.resolveIdentity(id, restore, candidateId)
  } finally {
    busy.value = false
  }
}
async function repair() {
  busy.value = true
  try {
    await store.repair()
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div
    v-if="issues.length"
    class="notes-issues q-px-md q-pb-sm"
    style="max-height: 25vh; overflow: auto"
  >
    <q-banner
      v-for="issue in issues.slice(0, limit)"
      :key="issue.id"
      dense
      class="note-banner bg-warning text-dark q-mb-xs"
    >
      {{ issue.message
      }}<span v-if="issue.candidateId">
        — {{ candidates.get(issue.candidateId) }}</span
      >
      <template #action>
        <template v-if="issue.kind === 'identity'">
          <q-select
            :model-value="selected[issue.id] ?? issue.candidateId"
            @update:model-value="selected[issue.id] = $event"
            :options="options"
            emit-value
            map-options
            dense
            outlined
            :label="t('notes.movedFile')"
            class="q-mr-sm"
            style="min-width: 220px"
          />
          <q-btn
            flat
            dense
            :disable="!issue.candidateId && !selected[issue.id]"
            :loading="busy"
            :label="t('notes.previousNote')"
            @click="
              decide(
                issue.id,
                true,
                selected[issue.id] ?? issue.candidateId ?? undefined
              )
            "
          />
          <q-btn
            flat
            dense
            :disable="busy"
            :label="
              t(
                issue.candidateId || selected[issue.id]
                  ? 'notes.newIdentity'
                  : 'notes.confirmDeletion'
              )
            "
            @click="
              decide(
                issue.id,
                false,
                selected[issue.id] ?? issue.candidateId ?? undefined
              )
            "
          />
        </template>
        <q-btn
          v-else-if="issue.kind === 'rewrite'"
          flat
          dense
          :loading="busy"
          :label="t('notes.repairLinks')"
          @click="repair"
        />
        <q-btn
          flat
          dense
          :disable="busy"
          :label="t('notes.later')"
          @click="postponed = [...postponed, issue.id]"
        />
      </template>
    </q-banner>
    <q-btn
      v-if="issues.length > limit"
      flat
      dense
      :label="t('notes.moreIssues')"
      @click="limit += 10"
    />
  </div>
</template>
