<script setup lang="ts">
import { mdiFolderOpenOutline } from '@mdi/js'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{ openFile: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="preview-empty column items-center justify-center q-pa-lg">
    <q-icon :name="mdiFolderOpenOutline" size="48px" class="app-icon-neutral" />
    <div class="q-my-md text-grey-6">{{ t('windows.empty') }}</div>
    <q-btn
      class="app-icon-control"
      outline
      color="primary"
      :icon="mdiFolderOpenOutline"
      :label="t('windows.openFile')"
      @click="emit('openFile')"
    />
    <div class="q-mt-sm text-caption text-grey-6">{{
      t('windows.dropFiles')
    }}</div>
  </div>
</template>

<style scoped>
.preview-empty {
  flex: 1;
}
</style>
