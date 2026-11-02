<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useArtifactsStore } from '@/stores/artifacts-store'
import ArtifactPane from './ArtifactPane.vue'
import ArtifactStatusBanners from './ArtifactStatusBanners.vue'

const { t } = useI18n()
const store = useArtifactsStore()
</script>

<template>
  <section class="column no-wrap fit artifact-document-panel">
    <ArtifactStatusBanners
      :loading="store.documentLoading"
      :error="store.documentError"
    >
      <template #action
        ><q-btn
          flat
          :label="t('artifacts.refresh')"
          @click="store.refreshDocument"
      /></template>
    </ArtifactStatusBanners>
    <ArtifactPane
      v-if="store.document"
      :key="store.document.storeId + ':' + store.document.id"
      :artifact="store.document"
      :body="store.body"
    />
    <div
      v-else-if="!store.documentLoading && !store.documentError"
      class="q-pa-lg text-grey"
      >{{ t('artifacts.select') }}</div
    >
  </section>
</template>

<style scoped>
.artifact-document-panel {
  min-width: 0;
  min-height: 0;
}
</style>
