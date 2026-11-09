<script setup lang="ts">
import { mdiMenuDown } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import type { Task } from '@/api/types'
import TaskStateBadge from './TaskStateBadge.vue'

defineProps<{ state: Task['state'] }>()
defineEmits<{ close: [] }>()
const { t } = useI18n()
</script>

<template>
  <q-btn
    v-if="state === 'open'"
    dense
    flat
    no-caps
    :aria-label="t('tasks.transition.button', { state: t('tasks.state.open') })"
  >
    <TaskStateBadge state="open" />
    <q-icon :name="mdiMenuDown" size="1.2em" class="app-icon-control" />
    <q-menu auto-close>
      <q-list dense style="min-width: 12rem">
        <q-item-label header>{{
          t('tasks.transition.menuTitle')
        }}</q-item-label>
        <q-item clickable @click="$emit('close')">
          <q-item-section>
            <q-item-label>{{ t('tasks.state.closed') }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
  <TaskStateBadge v-else state="closed" />
</template>
