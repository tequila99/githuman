<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DiffSource } from '@/stores/diff-store'
import { useFileActions } from '@/composables/use-file-actions'

defineProps<{ path: string; source: DiffSource }>()

const { t } = useI18n()
const { stage, unstage, discard } = useFileActions()
</script>

<template>
  <template v-if="source === 'unstaged'">
    <q-btn
      v-ripple
      flat
      dense
      round
      size="sm"
      icon="undo"
      :aria-label="t('changes.actions.discard')"
      :data-tooltip="t('changes.actions.discard')"
      @click.stop="discard(path)"
    />
    <q-btn
      v-ripple
      flat
      dense
      round
      size="sm"
      icon="add"
      :aria-label="t('changes.actions.stage')"
      :data-tooltip="t('changes.actions.stage')"
      @click.stop="stage(path)"
    />
  </template>
  <q-btn
    v-else
    v-ripple
    flat
    dense
    round
    size="sm"
    icon="remove"
    :aria-label="t('changes.actions.unstage')"
    :data-tooltip="t('changes.actions.unstage')"
    @click.stop="unstage(path)"
  />
</template>
