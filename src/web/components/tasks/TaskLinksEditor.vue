<script setup lang="ts">
import CloseButton from '@/components/buttons/CloseButton.vue'
import AddButton from '@/components/buttons/AddButton.vue'
import { useI18n } from 'vue-i18n'
import type { TaskLink } from '@/api/types'

// Matches the server limit on links per task.
const MAX_LINKS = 20

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
          maxlength="2048"
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
          maxlength="200"
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
          :disable="links.length >= MAX_LINKS"
          :label="t('tasks.links.add')"
          @click="add"
        />
      </div>
    </template>
  </section>
</template>
