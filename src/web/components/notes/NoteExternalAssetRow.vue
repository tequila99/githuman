<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExternalAssetRow } from '@/composables/notes/use-note-external-assets'
const props = defineProps<{ row: ExternalAssetRow; busy: boolean }>()
const emit = defineEmits<{
  visible: []
  select: [value: boolean]
  confirm: [allow: boolean]
}>()
const { t } = useI18n()
// Type shown to the user: file extension, or the asset kind when the name has none.
const typeLabel = computed(() => {
  const dot = props.row.name.lastIndexOf('.')
  const ext = dot > 0 ? props.row.name.slice(dot + 1) : ''
  return (ext || props.row.kind).toUpperCase()
})
</script>
<template>
  <q-intersection
    class="external-asset-slot"
    @visibility="value => value && emit('visible')"
  >
    <div class="external-asset-row q-py-sm">
      <q-checkbox
        :model-value="props.row.selected"
        :disable="busy"
        :aria-label="row.name"
        @update:model-value="emit('select', Boolean($event))"
      />
      <div class="external-asset-preview">
        <img v-if="row.preview" :src="row.preview" alt="" />
        <q-icon
          v-else
          :name="row.kind === 'pdf' ? 'picture_as_pdf' : 'image'"
          size="40px"
          color="grey"
        />
      </div>
      <div class="col" style="min-width: 0">
        <div class="external-asset-meta" :title="row.name">
          <span class="text-weight-medium">{{ typeLabel }}</span>
          <span class="text-grey">
            {{
              row.size === null
                ? t('notes.externalAssets.unknownSize')
                : t('notes.externalAssets.size', {
                    size: (row.size / 1000000).toFixed(2)
                  })
            }}
          </span>
        </div>
        <div
          v-if="row.previewState === 'error'"
          class="text-warning text-caption"
          >{{ t('notes.externalAssets.previewFailed') }}</div
        >
        <div
          class="text-caption"
          :class="row.state === 'error' ? 'text-negative' : 'text-grey'"
          role="status"
          >{{ t('notes.externalAssets.states.' + row.state) }}</div
        >
        <div
          v-if="row.error || row.reason"
          class="text-negative text-caption"
          >{{
            row.error || t('notes.externalAssets.errors.' + row.reason)
          }}</div
        >
        <div v-if="row.state === 'confirmation'" class="q-mt-xs">
          <div>{{ t('notes.externalAssets.largeWarning') }}</div>
          <q-btn
            flat
            color="primary"
            :label="t('notes.externalAssets.confirmLarge')"
            @click="emit('confirm', true)"
          />
          <q-btn
            flat
            :label="t('notes.externalAssets.skip')"
            @click="emit('confirm', false)"
          />
        </div>
      </div>
      <q-spinner v-if="row.state === 'loading'" size="20px" />
    </div>
  </q-intersection>
</template>
<style scoped>
.external-asset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #8883;
  min-height: 104px;
}
/* A hidden row is not mounted. The slot keeps its height. Without it, all hidden rows collapse and count as visible. */
.external-asset-slot {
  min-height: 104px;
}
.external-asset-preview {
  width: 120px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #8881;
}
.external-asset-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.external-asset-meta {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 0.9rem;
}
</style>
