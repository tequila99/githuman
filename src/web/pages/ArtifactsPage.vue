<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppPage from '@/components/AppPage.vue'
import PanelResize from '@/components/PanelResize.vue'
import ArtifactCatalogPanel from '@/components/artifacts/ArtifactCatalogPanel.vue'
import ArtifactDocumentPanel from '@/components/artifacts/ArtifactDocumentPanel.vue'
import { useArtifactDefinitions } from '@/composables/artifacts/use-artifact-definitions'
import { useArtifactsStore } from '@/stores/artifacts-store'
import {
  artifactFilterQuery,
  artifactRouteState
} from '@/utils/artifact-navigation'
import {
  useWorkspaceNavigation,
  enqueueWorkspaceNavigation
} from '@/composables/use-workspace-navigation'
import { useServerEvents } from '@/composables/use-server-events'
import type { ArtifactSearchItem } from '@/api/types'
import type { ArtifactCatalogFilters } from '@/types/artifacts'

const route = useRoute()
const router = useRouter()
const store = useArtifactsStore()
const workspace = useWorkspaceNavigation()
const state = computed(() => artifactRouteState(route.query))
const searchKey = computed(() => JSON.stringify(state.value.input))
const selectionKey = computed(() => JSON.stringify(state.value.selection))
const definitionsVisible = computed(
  () =>
    !workspace.narrow.value ||
    (!workspace.window.value &&
      (workspace.pane.value === 'list' || workspace.pane.value === 'content'))
)
const catalogVisible = computed(
  () =>
    definitionsVisible.value &&
    (!workspace.narrow.value || workspace.pane.value === 'list')
)
useArtifactDefinitions(
  () => store.storeId,
  () => definitionsVisible.value,
  () => store.catalog?.items ?? []
)
const tagOptions = computed(() =>
  [...new Set((store.catalog?.items ?? []).flatMap(item => item.tags))].sort(
    (a, b) => a.localeCompare(b)
  )
)
function applyFilters(filters: ArtifactCatalogFilters) {
  void enqueueWorkspaceNavigation(router, () => ({
    query: artifactFilterQuery(route.query, filters)
  }))
}
function updateQuery(value: string | null) {
  void enqueueWorkspaceNavigation(router, () => ({
    query: { ...route.query, q: value || undefined }
  }))
}
function select(item: ArtifactSearchItem) {
  void enqueueWorkspaceNavigation(router, () => ({
    query: {
      ...route.query,
      storeId: item.storeId,
      selectedId: item.id,
      ...(workspace.narrow.value
        ? { uiPane: 'content', uiWindow: undefined }
        : {})
    }
  }))
}
watch(searchKey, () => void store.search(state.value.input), {
  immediate: true
})
watch(selectionKey, () => void store.select(state.value.selection), {
  immediate: true
})
const events = useServerEvents(['artifacts:changed'], () => {
  void store.refresh()
  void store.refreshDocument()
})
onUnmounted(() => {
  events.close()
  store.cancel()
})
</script>

<template>
  <AppPage>
    <PanelResize
      class="fit"
      storage-key="githuman.artifactsListWidth"
      :default-width="340"
    >
      <template #panel>
        <ArtifactCatalogPanel
          :filters="state.filters"
          :query="state.input.query ?? null"
          :selected-id="state.selection?.id"
          :search-key="searchKey"
          :navigation-key="route.fullPath"
          :tag-options="tagOptions"
          :active="catalogVisible"
          @update:filters="applyFilters"
          @update:query="updateQuery"
          @select="select"
        />
      </template>
      <template #content>
        <ArtifactDocumentPanel />
      </template>
    </PanelResize>
  </AppPage>
</template>
