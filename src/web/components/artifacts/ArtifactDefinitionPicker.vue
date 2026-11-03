<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'

// Wait for a pause in typing before the server search request.
const SEARCH_DEBOUNCE_MS = 250

const props = defineProps<{
  storeId: string
  kind: 'task' | 'type'
  modelValue: string | string[] | null
  multiple?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
}>()
const { t } = useI18n()
const definitions = useArtifactDefinitionsStore().forStore(props.storeId)
const catalog = definitions.openSearch(props.kind)
onScopeDispose(catalog.close)
const query = shallowRef('')
const error = shallowRef<string | null>(null)
const ids = computed(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue
    : props.modelValue
      ? [props.modelValue]
      : []
)
function resolved(id: string) {
  return props.kind === 'task'
    ? definitions.taskLabels.get(id)
    : definitions.typeLabels.get(id)
}
const selected = computed(() => ids.value.flatMap(id => resolved(id) ?? []))
type Definition = NonNullable<ReturnType<typeof resolved>>
function label(item: Definition) {
  const name = 'title' in item ? item.title : item.label
  const inactive = 'state' in item ? item.state === 'closed' : !item.active
  return inactive
    ? name +
        ' · ' +
        t(
          props.kind === 'task'
            ? 'artifacts.definitions.closed'
            : 'artifacts.definitions.inactive'
        )
    : name
}
function labelOf(id: string) {
  const item = resolved(id)
  return item ? label(item) : id
}
const display = computed(() =>
  props.multiple ? undefined : labelOf(ids.value[0] ?? '')
)
const options = computed(() => {
  const items: Definition[] = [...(catalog.state.page?.items ?? [])]
  // Keep chosen items visible when they are outside the loaded pages.
  if (!query.value) {
    for (const item of selected.value) {
      if (!items.some(other => other.id === item.id)) {
        items.push(item)
      }
    }
  }
  return items.map(item => ({ value: item.id, label: label(item) }))
})
watch(
  ids,
  async current => {
    error.value = null
    try {
      await Promise.all(current.map(id => definitions.resolve(props.kind, id)))
    } catch {
      if (ids.value === current) {
        error.value = t('artifacts.definitions.unavailable')
      }
    }
  },
  { immediate: true }
)
watch(selected, value => {
  if (value.length === ids.value.length) error.value = null
})
function filter(value: string, update: (callback: () => void) => void) {
  update(() => {
    query.value = value
    void catalog.setText(value)
  })
}
// Retry after a failed request, and read the newest list on each open.
function onPopupShow() {
  if (catalog.state.stale) void catalog.refresh()
}
// Load the next page when the last option becomes visible.
function onVirtualScroll(details: {
  to: number
  ref: { refresh: () => void }
}) {
  if (
    details.to !== options.value.length - 1 ||
    !catalog.state.page?.nextCursor ||
    catalog.state.loading ||
    catalog.state.stale
  ) {
    return
  }
  void catalog.more().then(() => details.ref.refresh())
}
</script>
<template>
  <q-select
    class="artifact-definition-picker"
    :class="{ 'artifact-definition-picker--single': !multiple }"
    outlined
    dense
    clearable
    use-input
    emit-value
    map-options
    :multiple="multiple"
    :use-chips="multiple"
    :model-value="modelValue"
    :display-value="display"
    :options="options"
    :loading="catalog.state.loading"
    :label="
      t(
        kind === 'task'
          ? 'artifacts.definitions.task'
          : 'artifacts.definitions.type'
      )
    "
    :error="Boolean(error || catalog.state.error)"
    :error-message="error || catalog.state.error || ''"
    :input-debounce="SEARCH_DEBOUNCE_MS"
    @filter="filter"
    @popup-show="onPopupShow"
    @virtual-scroll="onVirtualScroll"
    @update:model-value="value => emit('update:modelValue', value)"
  >
    <template v-if="multiple" #selected-item="scope">
      <q-chip
        removable
        dense
        :tabindex="scope.tabindex"
        @remove="scope.removeAtIndex(scope.index)"
        >{{
          labelOf(
            typeof scope.opt === 'object' ? scope.opt.value : String(scope.opt)
          )
        }}</q-chip
      >
    </template>
    <template #no-option>
      <q-item>
        <q-item-section>{{
          t('artifacts.definitions.noMatches')
        }}</q-item-section>
      </q-item>
    </template>
  </q-select>
</template>

<style scoped>
.artifact-definition-picker {
  min-width: 0;
  max-width: 100%;
}
.artifact-definition-picker--single :deep(.q-field__native) {
  flex-wrap: nowrap;
}
</style>
