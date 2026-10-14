<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiFilter, mdiFilterOutline, mdiFilterRemoveOutline } from '@mdi/js'
import { useAppTheme } from '@/composables/use-app-theme'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import type { NoteTagFilter } from '@/types/notes'
import type { NoteEntry } from '../../../shared/notes/types.ts'
import NoteFilterDialog from './NoteFilterDialog.vue'

const props = defineProps<{ entries: NoteEntry[] }>()
const filter = defineModel<NoteTagFilter>({ required: true })
const open = shallowRef(false)
const { t } = useI18n()
const { isDark } = useAppTheme()
const active = computed(() => filter.value.tags.length > 0)
const options = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of props.entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
})
</script>
<template>
  <div
    class="note-filters row no-wrap"
    role="group"
    :aria-label="t('notes.filter')"
  >
    <q-btn
      flat
      round
      dense
      :icon="active ? mdiFilter : mdiFilterOutline"
      :color="active ? 'primary' : isDark ? 'grey-5' : 'grey-7'"
      :aria-label="t('notes.filter')"
      :aria-pressed="active"
      @click="open = true"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ t('notes.filter') }}</q-tooltip>
    </q-btn>
    <q-btn
      v-if="active"
      flat
      round
      dense
      :icon="mdiFilterRemoveOutline"
      :aria-label="t('notes.resetFilter')"
      @click="filter = { ...filter, tags: [] }"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('notes.resetFilter')
      }}</q-tooltip>
    </q-btn>
    <NoteFilterDialog
      v-model="open"
      v-model:filter="filter"
      :options="options"
    />
  </div>
</template>
