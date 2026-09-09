<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { type DiffSource } from '@/stores/diff-store'
defineProps<{
  stagedFilesLength: number
  unstagedFilesLength: number
}>()

const source = defineModel<DiffSource>({ default: 'staged' })
const { t } = useI18n()
</script>

<template>
  <q-tabs
    v-model="source"
    dense
    no-caps
    align="left"
    narrow-indicator
    class="text-primary q-mb-sm"
  >
    <q-tab name="staged">
      <div class="row items-center no-wrap q-gutter-x-xs">
        <span>{{ t('changes.staged') }}</span>
        <q-badge color="positive" rounded>
          {{ stagedFilesLength }}
        </q-badge>
      </div>
    </q-tab>
    <q-tab name="unstaged">
      <div class="row items-center no-wrap q-gutter-x-xs">
        <span>{{ t('changes.unstaged') }}</span>
        <q-badge color="warning" rounded>
          {{ unstagedFilesLength }}
        </q-badge>
      </div>
    </q-tab>
  </q-tabs>
</template>
