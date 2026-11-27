<script setup lang="ts">
import { mdiChevronDown } from '@mdi/js'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskSearch } from '@/composables/use-task-search'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const props = defineProps<{ storeId: string | null; disabled: boolean }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const filter = shallowRef('')
const tasks = useTaskSearch(() => props.storeId)

function onShow() {
  filter.value = ''
  tasks.open()
}
function onScroll(details: { to: number; ref: { refresh: () => void } }) {
  if (details.to !== tasks.items.value.length - 1) return
  void tasks.more().then(() => details.ref.refresh())
}
function onFilter(value: string | number | null) {
  filter.value = String(value ?? '')
  tasks.search(filter.value)
}
</script>

<template>
  <q-btn
    flat
    dense
    no-caps
    size="sm"
    class="app-icon-control agent-session-task-menu"
    :icon-right="mdiChevronDown"
    :label="t('agent.tasks.none')"
    :disable="disabled || !storeId"
    aria-haspopup="listbox"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ t('agent.tasks.hint') }}</q-tooltip>
    <q-menu
      anchor="bottom left"
      self="top left"
      class="agent-session-task-menu__popup"
      @before-show="onShow"
      @hide="tasks.close"
    >
      <div class="q-pa-xs">
        <q-input
          :model-value="filter"
          dense
          outlined
          autofocus
          :placeholder="t('agent.tasks.search')"
          @update:model-value="onFilter"
        />
      </div>
      <q-linear-progress v-if="tasks.loading.value" indeterminate />
      <q-item v-if="tasks.error.value" dense clickable @click="tasks.retry">
        <q-item-section class="text-negative">{{
          tasks.error.value
        }}</q-item-section>
      </q-item>
      <q-virtual-scroll
        v-if="tasks.items.value.length > 0"
        v-slot="{ item }"
        :items="tasks.items.value"
        :virtual-scroll-item-size="40"
        class="agent-menu agent-session-task-menu__list"
        @virtual-scroll="onScroll"
      >
        <q-item
          :key="item.id"
          v-close-popup
          dense
          clickable
          @click="emit('select', item.id)"
        >
          <q-item-section>
            <q-item-label :lines="1" :title="item.title">{{
              item.title
            }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-virtual-scroll>
      <q-item v-else-if="!tasks.loading.value && !tasks.error.value" dense>
        <q-item-section class="text-grey">{{
          t('agent.tasks.empty')
        }}</q-item-section>
      </q-item>
    </q-menu>
  </q-btn>
</template>

<style scoped>
.agent-session-task-menu {
  max-width: 100%;
  font-size: 12px;
}
.agent-session-task-menu :deep(.q-btn__content) {
  flex-wrap: nowrap;
}
:global(.agent-session-task-menu__popup) {
  width: 340px;
  max-width: calc(100vw - 24px);
}
.agent-session-task-menu__list {
  max-height: 300px;
}
.agent-session-task-menu__list :deep(.q-item__label) {
  white-space: nowrap;
}
</style>
