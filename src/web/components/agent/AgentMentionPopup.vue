<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { mentionParts } from '../../../shared/agents/mention-paths.ts'

const props = defineProps<{
  items: string[]
  active: number
  /** Viewport position of the list's bottom-left corner. */
  left: number
  bottom: number
  /** The `id` option `n` carries, for aria-activedescendant. */
  idPrefix: string
}>()
const emit = defineEmits<{ (e: 'pick', index: number): void }>()

const { t } = useI18n()
const $q = useQuasar()

const displayItems = computed(() =>
  props.items.map(path => ({ path, ...mentionParts(path) }))
)

watch(
  () => props.active,
  async index => {
    await nextTick()
    document
      .getElementById(`${props.idPrefix}-${index}`)
      ?.scrollIntoView({ block: 'nearest' })
  }
)
</script>

<template>
  <!-- In <body>: the chat panel clips anything that sticks out of it. -->
  <Teleport to="body">
    <div
      class="agent-mention-popup shadow-4"
      :class="$q.dark.isActive ? 'bg-grey-9 text-white' : 'bg-white text-dark'"
      role="listbox"
      :aria-label="t('agent.mention.list')"
      :style="{ left: `${left}px`, bottom: `${bottom}px` }"
      @mousedown.prevent
    >
      <div v-if="items.length === 0" class="q-pa-sm text-caption text-grey-6">
        {{ t('agent.mention.noFiles') }}
      </div>
      <div
        v-for="({ path, name, parent, directory }, i) in displayItems"
        :id="`${idPrefix}-${i}`"
        :key="path"
        role="option"
        class="agent-mention-popup__item"
        :class="{ 'agent-mention-popup__item--active': i === active }"
        :aria-selected="i === active"
        @click="emit('pick', i)"
      >
        <q-icon
          :name="directory ? 'folder' : 'description'"
          size="16px"
          class="agent-mention-popup__icon"
        />
        <span class="agent-mention-popup__name">{{ name }}</span>
        <span class="agent-mention-popup__dir">{{ parent }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-mention-popup {
  position: fixed;
  z-index: 6000;
  width: 340px;
  max-width: calc(100vw - 16px);
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  font-size: 13px;
}
.agent-mention-popup__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  cursor: pointer;
}
.agent-mention-popup__item--active {
  background: rgba(25, 118, 210, 0.18);
}
.agent-mention-popup__icon {
  flex: none;
  opacity: 0.7;
}
.agent-mention-popup__name {
  flex: 0 0 auto;
  font-weight: 500;
}
.agent-mention-popup__dir {
  min-width: 0;
  overflow: hidden;
  opacity: 0.6;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
</style>
