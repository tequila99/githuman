<script setup lang="ts">
import CloseButton from '@/components/buttons/CloseButton.vue'
import AddButton from '@/components/buttons/AddButton.vue'
import { useI18n } from 'vue-i18n'
import type { TaskLink } from '@/api/types'
import {
  TASK_LINK_LABEL_MAX_LENGTH,
  TASK_LINK_MAX_COUNT,
  TASK_LINK_URL_MAX_LENGTH
} from '../../../shared/tasks/constants.ts'

const props = defineProps<{ links: TaskLink[]; readonly: boolean }>()
const emit = defineEmits<{ 'update:links': [links: TaskLink[]] }>()
const { t } = useI18n()

function change(index: number, patch: Partial<TaskLink>) {
  emit(
    'update:links',
    props.links.map((link, i) => (i === index ? { ...link, ...patch } : link))
  )
}
function remove(index: number) {
  emit(
    'update:links',
    props.links.filter((_, i) => i !== index)
  )
}
function add() {
  emit('update:links', [...props.links, { url: '' }])
}
</script>
<template>
  <section class="column q-gutter-y-sm">
    <div class="text-subtitle2">{{ t('tasks.links.title') }}</div>
    <template v-if="readonly">
      <a
        v-for="link in links"
        :key="link.url"
        :href="link.url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ link.label || link.url }}</a
      >
      <div v-if="!links.length" class="text-grey">{{
        t('tasks.links.none')
      }}</div>
    </template>
    <template v-else>
      <div
        v-for="(link, index) in links"
        :key="index"
        class="row items-center no-wrap q-gutter-x-sm"
      >
        <q-input
          class="col-7"
          dense
          outlined
          :maxlength="TASK_LINK_URL_MAX_LENGTH"
          :model-value="link.url"
          :label="t('tasks.links.url')"
          @update:model-value="
            value => change(index, { url: String(value ?? '') })
          "
        />
        <q-input
          class="col"
          dense
          outlined
          :maxlength="TASK_LINK_LABEL_MAX_LENGTH"
          :model-value="link.label ?? ''"
          :label="t('tasks.links.label')"
          @update:model-value="
            value => change(index, { label: String(value ?? '') })
          "
        />
        <CloseButton :label="t('tasks.links.remove')" @click="remove(index)" />
      </div>
      <div>
        <AddButton
          :disable="links.length >= TASK_LINK_MAX_COUNT"
          :label="t('tasks.links.add')"
          @click="add"
        />
      </div>
    </template>
  </section>
</template>
