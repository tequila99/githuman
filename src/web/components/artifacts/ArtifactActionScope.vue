<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArtifactCommandLabel } from '@/composables/artifacts/use-artifact-command-label'
import { useArtifactTitles } from '@/composables/artifacts/use-artifact-titles'
import type { ArtifactActionInspection } from '@/api/types'

// Badge color of each validator verdict; an unknown state stays grey.
const VERDICT_COLORS: Record<string, string> = {
  pass: 'positive',
  conflict: 'negative',
  incomplete: 'warning'
}

const props = defineProps<{
  inspection: ArtifactActionInspection
  sessionLabel: string
}>()
const { t, te } = useI18n()
const commandLabel = useArtifactCommandLabel()
const change = computed(() => props.inspection.proposal?.changeSet ?? null)
const titles = computed(
  () =>
    new Map(
      (props.inspection.preview?.postState ?? []).map(item => [
        item.id,
        item.title
      ])
    )
)
// A decision can name a document that the preview does not carry; look it up.
const lookedUp = useArtifactTitles(() =>
  (change.value?.supplementDispositions ?? [])
    .map(item => item.artifactId)
    .filter(id => !titles.value.has(id))
)
function title(id: string): string {
  return titles.value.get(id) ?? lookedUp.value[id] ?? id
}
// The validator verdict decides whether to authorize, so it sits next to the command.
const verdict = computed(
  () =>
    props.inspection.validation?.report?.verdict ??
    props.inspection.validation?.state ??
    null
)
const verdictColor = computed(
  () => VERDICT_COLORS[verdict.value ?? ''] ?? 'grey'
)
function verdictLabel(value: string): string {
  const key = `artifacts.actions.states.${value}`
  return te(key) ? t(key) : value
}
const changing = computed(() => change.value?.targetStatuses ?? [])
// Documents the validator reads and the commit re-checks, but whose status stays.
const checkedOnly = computed(() => {
  const moved = new Set(changing.value.map(item => item.artifactId))
  return (props.inspection.preview?.affectedIds ?? []).filter(
    id => !moved.has(id)
  )
})
</script>

<template>
  <div v-if="change">
    <div class="row items-center no-wrap q-gutter-x-sm">
      <div class="text-subtitle2">
        {{ commandLabel(change.command) }}
      </div>
      <q-badge
        v-if="verdict"
        :color="verdictColor"
        :title="t('artifacts.actions.verdict')"
        :label="`${t('artifacts.actions.validator')}: ${verdictLabel(verdict)}`"
      />
    </div>
    <div class="text-caption">
      {{ t('artifacts.actions.sourceChat') }}: {{ sessionLabel }}
    </div>
    <div class="text-caption">
      {{ t('artifacts.actions.proposedBy') }}:
      {{ inspection.proposal?.actor.kind }} ·
      {{
        t('artifacts.actions.version', {
          version: inspection.proposal?.version
        })
      }}
    </div>
    <div class="q-mt-sm">
      <span class="text-weight-medium"
        >{{ t('artifacts.actions.reason') }}:</span
      >
      {{ ' ' }}
      <span class="artifact-scope__text">{{ change.reason }}</span>
    </div>

    <div class="text-subtitle2 q-mt-md">{{
      t('artifacts.actions.changes', { count: changing.length })
    }}</div>
    <q-list dense separator class="artifact-scope__list">
      <q-item v-for="item in changing" :key="item.artifactId">
        <q-item-section>
          <q-item-label class="artifact-scope__text">{{
            title(item.artifactId)
          }}</q-item-label>
          <q-item-label caption>→ {{ item.status }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>

    <template v-if="checkedOnly.length">
      <div class="text-subtitle2 q-mt-md">{{
        t('artifacts.actions.checkedOnly', { count: checkedOnly.length })
      }}</div>
      <q-list dense separator class="artifact-scope__list">
        <q-item v-for="id in checkedOnly" :key="id">
          <q-item-section>
            <q-item-label class="artifact-scope__text">{{
              title(id)
            }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </template>

    <div v-if="change.relationChanges.length" class="q-mt-md">
      {{
        t('artifacts.actions.relationChanges', {
          count: change.relationChanges.length
        })
      }}
    </div>
    <template v-if="change.supplementDispositions.length">
      <div class="text-subtitle2 q-mt-md">{{
        t('artifacts.actions.dispositions')
      }}</div>
      <ul class="q-my-xs">
        <li
          v-for="item in change.supplementDispositions"
          :key="item.artifactId"
          class="artifact-scope__text"
          >{{ title(item.artifactId) }}: {{ item.disposition }}</li
        >
      </ul>
    </template>

    <q-expansion-item
      dense
      class="q-mt-md"
      :label="t('artifacts.actions.details')"
    >
      <div class="text-caption artifact-scope__text">
        {{ t('artifacts.actions.digest') }}:
        {{ inspection.proposal?.changeDigest }}
      </div>
      <div class="text-caption artifact-scope__text">
        {{ t('artifacts.actions.expectedVersions') }}:
      </div>
      <ul class="q-my-xs text-caption artifact-scope__list">
        <li v-for="item in change.expectedVersions" :key="item.id">
          {{ item.id }} · v{{ item.version }}
        </li>
      </ul>
      <div class="text-caption artifact-scope__text">
        {{ t('artifacts.actions.subjects') }}:
        {{ change.subjectIds.join(', ') }}
      </div>
    </q-expansion-item>
  </div>
</template>

<style scoped>
/* Document titles and reasons are data: wrap them, never cut them. */
.artifact-scope__text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.artifact-scope__list {
  max-height: 16rem;
  overflow-y: auto;
}
</style>
