<script setup lang="ts">
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{ title: string; readonly: boolean }>()
const emit = defineEmits<{ 'update:title': [title: string] }>()
const { t } = useI18n()
const editingTitle = shallowRef(false)
</script>

<template>
  <button
    v-if="!editingTitle"
    type="button"
    class="task-pane__title text-h5 ellipsis-2-lines"
    :title="title"
    :aria-label="t('tasks.titleField') + ': ' + title"
    :disabled="readonly"
    @click="editingTitle = true"
    >{{ title }}</button
  >
  <q-input
    v-else
    autofocus
    borderless
    dense
    maxlength="1000"
    @blur="editingTitle = false"
    @keydown.enter.prevent="editingTitle = false"
    input-class="text-h5"
    :readonly="readonly"
    :model-value="title"
    :aria-label="t('tasks.titleField')"
    @update:model-value="value => emit('update:title', String(value ?? ''))"
  />
</template>

<style scoped>
.task-pane__title {
  display: -webkit-box;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 1.5rem;
  line-height: 2rem;
  text-align: left;
  cursor: text;
  overflow-wrap: anywhere;
}
.task-pane__title:disabled {
  opacity: 1;
  cursor: default;
}
</style>
