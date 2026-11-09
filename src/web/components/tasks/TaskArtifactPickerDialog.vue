<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { debounce } from 'quasar'
import { ARTIFACT_STATUSES } from '../../../shared/artifacts/constants.ts'
import { artifactsApi } from '@/api/artifacts'
import type { ArtifactSearchItem } from '@/api/types'
import ArtifactCatalogItem from '@/components/artifacts/ArtifactCatalogItem.vue'
import CatalogPickerDialog from '@/components/CatalogPickerDialog.vue'
import { errorMessage } from '@/utils/error-message'

// Wait for a typing pause before requesting candidates.
const SEARCH_DELAY_MS = 300
// Bound each page requested by infinite scrolling.
const CANDIDATE_LIMIT = 20

const open = defineModel<boolean>({ required: true })
defineProps<{ storeId: string | null }>()
const emit = defineEmits<{ select: [item: ArtifactSearchItem] }>()
const { t } = useI18n()
const query = shallowRef('')
const candidates = shallowRef<ArtifactSearchItem[]>([])
const error = shallowRef<string | null>(null)
const searchLoading = shallowRef(false)
const nextCursor = shallowRef<string | null>(null)
let searchGeneration = 0

async function runSearch(append = false) {
  const mine = append ? searchGeneration : ++searchGeneration
  searchLoading.value = true
  try {
    const result = await artifactsApi.search({
      query: query.value,
      filters: {
        statuses: ARTIFACT_STATUSES.filter(status => status !== 'deleted'),
        unbound: true
      },
      limit: CANDIDATE_LIMIT,
      ...(append && nextCursor.value ? { cursor: nextCursor.value } : {})
    })
    if (mine !== searchGeneration) return
    candidates.value = append
      ? [...candidates.value, ...result.items]
      : result.items
    nextCursor.value = result.nextCursor
    error.value = null
  } catch (err) {
    if (mine === searchGeneration) {
      error.value = errorMessage(err)
      nextCursor.value = null
    }
  } finally {
    if (mine === searchGeneration) searchLoading.value = false
  }
}
const search = debounce(() => void runSearch(), SEARCH_DELAY_MS)
function resetSearch() {
  searchGeneration++
  candidates.value = []
  nextCursor.value = null
  searchLoading.value = true
  search()
}
async function loadMore(done: (stop?: boolean) => void) {
  if (!searchLoading.value && nextCursor.value) await runSearch(true)
  done()
}
onBeforeUnmount(() => {
  searchGeneration++
  search.cancel()
})
void runSearch()
</script>

<template>
  <CatalogPickerDialog
    v-model="open"
    v-model:query="query"
    :title="t('tasks.artifacts.add')"
    :search-label="t('tasks.artifacts.search')"
    :empty="!candidates.length"
    infinite
    :loading="searchLoading"
    :has-more="Boolean(nextCursor)"
    @load-more="loadMore"
    :empty-label="t('tasks.artifacts.noCandidates')"
    @search="resetSearch"
  >
    <div v-if="error" role="alert" class="text-negative q-pa-md">{{
      error
    }}</div>
    <ArtifactCatalogItem
      v-for="item in candidates"
      :key="item.id"
      :item="item"
      :selected="false"
      :store-id="storeId"
      @select="emit('select', item)"
    />
  </CatalogPickerDialog>
</template>
