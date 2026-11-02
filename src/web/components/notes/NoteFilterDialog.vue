<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import FilterDialog from '@/components/FilterDialog.vue'
import TagFilterField from '@/components/TagFilterField.vue'
import type { NoteTagMode } from '@/utils/note-navigation'
import type { NoteTagFilter } from '@/types/notes'

const open = defineModel<boolean>({ required: true })
const filter = defineModel<NoteTagFilter>('filter', { required: true })
const props = defineProps<{ options: [string, number][] }>()
const tagOptions = computed(() => props.options.map(([tag]) => tag))
const pendingTags = shallowRef<string[]>([])
const pendingMode = shallowRef<NoteTagMode>('all')
function prepare() {
  pendingTags.value = [...filter.value.tags]
  pendingMode.value = filter.value.mode
}
function reset() {
  pendingTags.value = []
  pendingMode.value = 'all'
}
function apply() {
  filter.value = { tags: [...pendingTags.value], mode: pendingMode.value }
  open.value = false
}
</script>

<template>
  <FilterDialog
    v-model="open"
    :can-reset="pendingTags.length > 0"
    @prepare="prepare"
    @reset="reset"
    @apply="apply"
  >
    <TagFilterField
      v-model:tags="pendingTags"
      v-model:mode="pendingMode"
      :options="tagOptions"
    />
  </FilterDialog>
</template>
