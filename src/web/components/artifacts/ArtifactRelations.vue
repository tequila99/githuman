<script setup lang="ts">
import {
  mdiLinkVariant,
  mdiArrowTopRight,
  mdiArrowBottomLeft,
  mdiSourceBranch,
  mdiFileReplaceOutline,
  mdiFilePlusOutline,
  mdiFileTreeOutline
} from '@mdi/js'
import { computed, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Artifact } from '@/api/types'
import { createArtifactLinks } from '@/utils/artifact-links'
import { useArtifactDetailPage } from '@/composables/artifacts/use-artifact-detail-page'
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import { artifactDocumentRoute } from '@/utils/artifact-navigation'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import ArtifactDetailState from './ArtifactDetailState.vue'

// The list grows with its links up to this many rows, then it scrolls.
const VISIBLE_ROWS = 4
// Minimum height of one Quasar list item.
const ROW_HEIGHT_PX = 48
const LIST_MAX_HEIGHT = `${VISIBLE_ROWS * ROW_HEIGHT_PX}px`

// Relationship kinds retain their existing order within each direction.
const KIND_ICONS = {
  parent: mdiFileTreeOutline,
  replaces: mdiFileReplaceOutline,
  supplements: mdiFilePlusOutline,
  references: mdiLinkVariant
}
const props = defineProps<{ artifact: Artifact }>()
const { t } = useI18n()
const route = useRoute()
const paneVisible = usePaneVisibility()
const listScroll = useTemplateRef<HTMLElement>('listScroll')
const resource = useArtifactDetailPage(
  createArtifactLinks(props.artifact),
  true
)
const { outgoing, incoming, ancestry, names, loading, stale, error, hasMore } =
  resource
async function loadMore(_index: number, done: () => void) {
  try {
    await resource.more()
  } finally {
    done()
  }
}
const entries = computed(() => {
  const edges = [outgoing, incoming].flatMap((page, index) =>
    (page.state.page?.items ?? []).map(edge => ({
      id: index === 0 ? edge.targetId : edge.sourceId,
      key: `${index}:${edge.sourceId}:${edge.kind}:${edge.targetId}`,
      icon: KIND_ICONS[edge.kind],
      directionIcon: index === 0 ? mdiArrowTopRight : mdiArrowBottomLeft,
      label: `${t('artifacts.details.' + (index === 0 ? 'outgoing' : 'incoming'))}: ${t('artifacts.details.kinds.' + edge.kind)}`
    }))
  )
  return [
    ...edges,
    ...(ancestry.state.page?.ancestorIds ?? []).map(id => ({
      id,
      key: `ancestor:${id}`,
      icon: mdiSourceBranch,
      directionIcon: '',
      label: t('artifacts.details.lineage')
    }))
  ].map(entry => ({
    ...entry,
    title: names.titles.get(entry.id) ?? entry.id,
    route: artifactDocumentRoute(props.artifact.storeId, entry.id, route.query)
  }))
})
</script>
<template>
  <div class="q-mb-md">
    <ArtifactDetailState :loading="loading" :stale="stale" :error="error" />
    <div ref="listScroll" class="artifact-relations__list">
      <q-infinite-scroll
        v-if="listScroll"
        :scroll-target="listScroll"
        :offset="100"
        :disable="!hasMore || loading || stale || !paneVisible()"
        @load="loadMore"
      >
        <q-list separator>
          <q-item
            v-for="entry in entries"
            :key="entry.key"
            :to="entry.route"
            clickable
          >
            <q-item-section avatar class="app-icon-neutral">
              <q-icon :name="entry.icon" size="24px" :aria-label="entry.label">
                <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
                  entry.label
                }}</q-tooltip>
              </q-icon>
            </q-item-section>
            <q-item-section
              ><q-item-label class="artifact-relations__title">{{
                entry.title
              }}</q-item-label></q-item-section
            >
            <q-item-section
              v-if="entry.directionIcon"
              side
              class="app-icon-neutral"
            >
              <q-icon :name="entry.directionIcon" :aria-label="entry.label" />
            </q-item-section>
          </q-item>
        </q-list>
        <template #loading>
          <div class="row justify-center q-pa-sm">
            <q-spinner color="primary" />
          </div>
        </template>
      </q-infinite-scroll>
    </div>
  </div>
</template>
<style scoped>
.artifact-relations__list {
  max-height: v-bind(LIST_MAX_HEIGHT);
  overflow-y: auto;
}
.artifact-relations__title {
  overflow-wrap: anywhere;
}
</style>
