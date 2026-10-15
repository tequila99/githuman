<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ExternalAssetRow } from '@/composables/notes/use-note-external-assets'
import NoteExternalAssetRow from './NoteExternalAssetRow.vue'
const props = defineProps<{
  open: boolean
  rows: ExternalAssetRow[]
  busy: boolean
  replacements: number
  canRestore: boolean
}>()
const emit = defineEmits<{
  close: []
  download: []
  restore: []
  selectAll: [value: boolean]
  inspect: [row: ExternalAssetRow]
  select: [row: ExternalAssetRow, value: boolean]
  confirm: [allow: boolean]
}>()
const { t } = useI18n()
</script>
<template>
  <q-dialog
    :model-value="open"
    @update:model-value="value => !value && emit('close')"
  >
    <q-card class="external-assets-dialog">
      <q-card-section class="text-h6">{{
        t('notes.externalAssets.title')
      }}</q-card-section>
      <q-card-section class="q-py-none text-caption">{{
        t('notes.externalAssets.limits')
      }}</q-card-section>
      <q-card-section class="q-pb-none row q-gutter-x-sm">
        <q-btn
          flat
          round
          dense
          icon="done_all"
          :disable="busy"
          :aria-label="t('notes.externalAssets.selectAll')"
          @click="emit('selectAll', true)"
        >
          <q-tooltip>{{ t('notes.externalAssets.selectAll') }}</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          icon="remove_done"
          :disable="busy"
          :aria-label="t('notes.externalAssets.selectNone')"
          @click="emit('selectAll', false)"
        >
          <q-tooltip>{{ t('notes.externalAssets.selectNone') }}</q-tooltip>
        </q-btn>
      </q-card-section>
      <q-card-section class="external-assets-list scroll">
        <NoteExternalAssetRow
          v-for="row in rows"
          :key="row.url"
          :row="row"
          :busy="busy"
          @visible="emit('inspect', row)"
          @select="emit('select', row, $event)"
          @confirm="emit('confirm', $event)"
        />
      </q-card-section>
      <q-card-section v-if="replacements" class="q-py-xs" role="status">{{
        t('notes.externalAssets.result', { count: replacements })
      }}</q-card-section>
      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          v-if="canRestore"
          flat
          :label="t('notes.externalAssets.restore')"
          @click="emit('restore')"
        />
        <q-btn
          flat
          :label="
            t(busy ? 'notes.externalAssets.stop' : 'notes.externalAssets.close')
          "
          @click="emit('close')"
        />
        <q-btn
          color="primary"
          :loading="busy"
          :disable="
            !props.rows.some(row => row.selected && row.state !== 'done')
          "
          :label="t('notes.externalAssets.download')"
          @click="emit('download')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<style scoped>
.external-assets-dialog {
  width: 820px;
  max-width: 95vw;
  /* Fixed height: the dialog must not jump with the number of rows. */
  height: min(720px, 90vh);
  display: flex;
  flex-direction: column;
}
.external-assets-list {
  min-height: 0;
  flex: 1;
}
</style>
