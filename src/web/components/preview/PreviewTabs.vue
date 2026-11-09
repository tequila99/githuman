<script setup lang="ts">
import AddButton from '@/components/buttons/AddButton.vue'
import CloseButton from '@/components/buttons/CloseButton.vue'
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { mentionLabel } from '@/utils/mention-editor'
import type { PreviewTab } from '@/types/windows/preview'

defineProps<{ tabs: PreviewTab[]; activeId: string | null }>()
const emit = defineEmits<{
  activate: [id: string]
  openFile: []
  requestClose: [id: string]
}>()
const { t } = useI18n()
function tabLabel(tab: PreviewTab): string {
  if (tab.source.type !== 'file') return tab.title
  const name = mentionLabel(tab.source.path, [])
  return tab.kind === 'diagram'
    ? `${name} · ${t('windows.diagram')} · ${tab.index + 1}`
    : name
}
</script>

<template>
  <div class="preview-tabs row items-center no-wrap">
    <q-tabs
      v-if="tabs.length"
      :model-value="activeId"
      dense
      shrink
      no-caps
      outside-arrows
      mobile-arrows
      align="left"
      class="preview-tabs__tabs"
      @update:model-value="emit('activate', String($event))"
    >
      <q-tab v-for="tab in tabs" :key="tab.id" :name="tab.id">
        <div class="row items-center no-wrap"
          ><span class="preview-tab-label ellipsis"
            >{{ tabLabel(tab)
            }}<q-tooltip :delay="TOOLTIP_DELAY_MS">{{
              tab.title
            }}</q-tooltip></span
          ><CloseButton
            size="xs"
            :label="t('windows.closeTab')"
            @click.stop="emit('requestClose', tab.id)"
        /></div>
      </q-tab>
    </q-tabs>
    <AddButton
      size="sm"
      class="q-mx-xs"
      :tooltip="t('windows.openFile')"
      @click="emit('openFile')"
    />
  </div>
</template>

<style scoped>
.preview-tabs {
  flex: 0 0 auto;
  min-height: 36px;
  border-bottom: 1px solid var(--window-divider);
}
.preview-tabs__tabs {
  min-width: 0;
}
.preview-tab-label {
  max-width: 240px;
}
</style>
