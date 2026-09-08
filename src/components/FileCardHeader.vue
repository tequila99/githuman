<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import CopyButton from './CopyButton.vue'

defineProps<{ path: string }>()

const { t } = useI18n()
</script>

<template>
  <div class="file-card-header row items-center no-wrap">
    <slot name="leading" />
    <div class="file-card-header__name row items-center no-wrap">
      <span class="ellipsis text-mono file-card-header__path">{{ path }}</span>
      <CopyButton :value="path" :tooltip="t('common.copyPath')" />
    </div>
    <q-space />
    <slot />
  </div>
</template>

<style scoped>
.file-card-header {
  background: var(--diff-header-bg);
  width: 100%;
  min-width: 0;
  padding: 6px 12px;
  column-gap: 8px;
}

.file-card-header__name {
  flex: 0 1 auto;
  min-width: 0;
  column-gap: 4px;
}

.file-card-header__path {
  min-width: 0;
}
</style>
