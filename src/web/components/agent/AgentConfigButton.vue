<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentConfigOption } from '@/api/types'

/** Above this many choices the menu gets a filter box (pi offers hundreds of models). */
const FILTER_THRESHOLD = 8

const props = defineProps<{
  option: AgentConfigOption
  /** The agent is answering — its settings can't change mid-turn. */
  disabled: boolean
  /** Shown in the tooltip, e.g. the key that cycles this setting. */
  hint?: string
}>()
const emit = defineEmits<{ (e: 'select', value: string | boolean): void }>()

const { t } = useI18n()
const filter = ref('')

const choices = computed(() => props.option.options ?? [])
const shown = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  return needle === ''
    ? choices.value
    : choices.value.filter(
        c =>
          c.name.toLowerCase().includes(needle) ||
          c.value.toLowerCase().includes(needle)
      )
})
const current = computed(
  () =>
    choices.value.find(c => c.value === props.option.currentValue)?.name ??
    String(props.option.currentValue)
)
</script>

<template>
  <q-btn
    v-if="option.type === 'boolean'"
    flat
    dense
    no-caps
    size="sm"
    class="agent-cfg"
    :disable="disabled"
    :icon="
      option.currentValue === true ? 'check_box' : 'check_box_outline_blank'
    "
    :label="option.name"
    @click="emit('select', option.currentValue !== true)"
  />
  <q-btn
    v-else
    flat
    dense
    no-caps
    size="sm"
    icon-right="expand_more"
    class="agent-cfg"
    :disable="disabled"
    :label="current"
    :aria-label="`${option.name}: ${current}`"
    aria-haspopup="listbox"
  >
    <q-tooltip :delay="500">
      {{ option.name }}<template v-if="hint"> · {{ hint }}</template>
    </q-tooltip>
    <q-menu anchor="top left" self="bottom left" @before-show="filter = ''">
      <div v-if="choices.length > FILTER_THRESHOLD" class="q-pa-xs">
        <q-input
          v-model="filter"
          dense
          outlined
          autofocus
          :placeholder="t('agent.config.filter')"
        />
      </div>
      <q-virtual-scroll
        v-if="shown.length > 0"
        v-slot="{ item }"
        :items="shown"
        :virtual-scroll-item-size="40"
        class="agent-menu agent-cfg__list"
      >
        <q-item
          :key="item.value"
          v-close-popup
          dense
          clickable
          @click="emit('select', item.value)"
        >
          <!-- The current choice carries a check; the column stays so names line up. -->
          <q-item-section avatar>
            <q-icon
              v-if="item.value === option.currentValue"
              name="check"
              size="16px"
              color="primary"
            />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ item.name }}</q-item-label>
            <q-item-label v-if="item.description || item.group" caption>
              {{ item.group }}{{ item.group && item.description ? ' · ' : ''
              }}{{ item.description }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-virtual-scroll>
      <q-item v-else dense>
        <q-item-section class="text-grey">
          {{ t('agent.config.noMatch') }}
        </q-item-section>
      </q-item>
    </q-menu>
  </q-btn>
</template>

<style scoped>
.agent-cfg {
  max-width: 190px;
  font-size: 12px;
}
.agent-cfg :deep(.q-btn__content) {
  flex-wrap: nowrap;
}
.agent-cfg :deep(.block) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-cfg__list {
  width: 340px;
  max-width: calc(100vw - 24px);
  min-width: 220px;
  max-height: 300px;
}
</style>
