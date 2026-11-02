<script setup lang="ts">
import { computed } from 'vue'
import AddToAgentButton from '@/components/buttons/AddToAgentButton.vue'
import RefreshButton from '@/components/buttons/RefreshButton.vue'
import { provideArtifactRefresh } from '@/composables/artifacts/artifact-refresh'
import { useArtifactsStore } from '@/stores/artifacts-store'
import {
  canStartTransition,
  canUseOriginal
} from '@/utils/artifact-content-state'
import { useI18n } from 'vue-i18n'
import MarkdownContent from '@/components/MarkdownContent.vue'
import ArtifactExportMenu from './ArtifactExportMenu.vue'
import ArtifactMetadata from './ArtifactMetadata.vue'
import ArtifactStatusButton from './ArtifactStatusButton.vue'
import ArtifactRelations from './ArtifactRelations.vue'
import ArtifactHistory from './ArtifactHistory.vue'
import type { Artifact } from '@/api/types'

defineProps<{
  artifact: Artifact
  body: string
}>()
const { t } = useI18n()
const store = useArtifactsStore()
// The header Refresh checks the body again, unlike the silent catch-up on events.
const { loading: refreshing, refresh } = provideArtifactRefresh(
  store.retryContent
)
const contentReady = computed(() => canStartTransition(store.contentState))
const originalAllowed = computed(() => canUseOriginal(store.contentErrorKind))
</script>

<template>
  <section class="artifact-pane column no-wrap fit">
    <div class="q-pa-md">
      <h1 class="text-h5 q-my-sm">{{ artifact.title }}</h1>
      <div class="row items-center q-gutter-sm">
        <ArtifactStatusButton
          :key="artifact.id"
          :artifact="artifact"
          :content-ready="contentReady"
        />
        <span class="text-caption">{{ artifact.typeId }}</span>
        <q-space />
        <AddToAgentButton
          :dense="false"
          :disable="!originalAllowed"
          :title="originalAllowed ? undefined : t('artifacts.content.blocked')"
          :label="t('artifacts.addToAgent')"
          :context="{
            kind: 'artifact',
            storeId: artifact.storeId,
            artifactId: artifact.id,
            name: artifact.title
          }"
        />
        <ArtifactExportMenu
          :key="artifact.id"
          :artifact-id="artifact.id"
          :original-allowed="originalAllowed"
        />
        <q-spinner
          v-if="store.verifying"
          size="1em"
          role="status"
          :aria-label="t('artifacts.content.verifying')"
        />
        <RefreshButton
          :dense="false"
          :loading="refreshing"
          :tooltip="t('artifacts.refresh')"
          @click="refresh"
        />
      </div>
      <div class="text-caption q-mt-sm">{{
        t('artifacts.currentMetadata')
      }}</div>
      <div v-if="artifact.tags.length" class="q-mt-sm document-tags">
        <q-chip v-for="tag in artifact.tags" :key="tag" dense>{{ tag }}</q-chip>
      </div>
    </div>
    <q-separator />
    <q-scroll-area class="col">
      <div class="q-pa-lg artifact-pane__body">
        <ArtifactMetadata :artifact="artifact" />
        <ArtifactHistory :artifact="artifact" />
        <ArtifactRelations :artifact="artifact" />
        <MarkdownContent
          v-if="store.contentState === 'ready'"
          :text="body"
          variant="document"
          disable-images
          heading-anchors
        />
        <div
          v-else-if="store.contentState === 'loading'"
          class="row items-center q-gutter-sm"
          role="status"
        >
          <q-spinner size="1em" />
          <span>{{ t('artifacts.content.loading') }}</span>
        </div>
        <q-banner
          v-else-if="store.contentState === 'error'"
          dense
          class="bg-negative text-white"
          role="alert"
        >
          <div class="text-weight-medium">{{
            t(
              store.contentErrorKind === 'integrity'
                ? 'artifacts.content.integrity'
                : 'artifacts.content.failed'
            )
          }}</div>
          <div>{{ store.contentError }}</div>
          <div class="text-caption q-mt-xs">{{
            t('artifacts.content.hint')
          }}</div>
          <template #action>
            <q-btn
              flat
              no-caps
              :label="t('artifacts.content.retry')"
              :disable="store.documentLoading"
              @click="store.retryContent"
            />
          </template>
        </q-banner>
      </div>
    </q-scroll-area>
  </section>
</template>

<style scoped>
.artifact-pane {
  min-width: 0;
}
/* Keep wide tables and code in their own scrollers instead of expanding QScrollArea content. */
.artifact-pane :deep(.q-scrollarea__content) {
  width: 100%;
}
.artifact-pane__body {
  min-width: 0;
}
</style>
