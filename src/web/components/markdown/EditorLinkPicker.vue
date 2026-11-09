<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiNoteTextOutline } from '@mdi/js'
import CatalogPickerDialog from '@/components/CatalogPickerDialog.vue'
import CatalogListItem from '@/components/CatalogListItem.vue'
import ArtifactCatalogItem from '@/components/artifacts/ArtifactCatalogItem.vue'
import type { EditorLinkSource, EditorLinkTarget } from '@/utils/editor-links'

const props = defineProps<{ source: EditorLinkSource }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ select: [target: EditorLinkTarget] }>()
const { t } = useI18n()
const query = shallowRef('')
const tab = shallowRef<'notes' | 'artifacts'>('notes')
const matches = computed(() =>
  props.source.matches.value.filter(target =>
    tab.value === 'artifacts' ? Boolean(target.artifact) : !target.artifact
  )
)

function search() {
  props.source.setQuery(query.value)
}
function select(target: EditorLinkTarget) {
  emit('select', target)
  open.value = false
}
function selectFirst() {
  const target = matches.value[0]
  if (target) select(target)
}
function show() {
  tab.value = 'notes'
  query.value = ''
  search()
}
</script>
<template>
  <CatalogPickerDialog
    v-model="open"
    v-model:query="query"
    :title="t('markdown.insertLink')"
    :search-label="t('markdown.findLink')"
    :empty="!matches.length"
    :empty-label="t('markdown.noMatches')"
    @before-show="show"
    @hide="source.setQuery(null)"
    @search="search"
    @search-enter="selectFirst"
  >
    <template #filters>
      <q-tabs
        v-model="tab"
        dense
        no-caps
        align="left"
        active-color="primary"
        class="col-auto"
      >
        <q-tab name="notes" :label="t('notes.title')" />
        <q-tab name="artifacts" :label="t('artifacts.title')" />
      </q-tabs>
      <q-separator />
    </template>
    <template v-for="target in matches" :key="target.key">
      <ArtifactCatalogItem
        v-if="target.artifact"
        :item="target.artifact"
        :store-id="target.artifact.storeId"
        :selected="false"
        @select="select(target)"
      />
      <CatalogListItem v-else :title="target.label" @click="select(target)">
        <template #icon>
          <q-icon :name="mdiNoteTextOutline" size="18px" />
        </template>
        <template #metadata>
          <span class="ellipsis" :title="target.caption">{{
            target.caption
          }}</span>
        </template>
      </CatalogListItem>
    </template>
  </CatalogPickerDialog>
</template>
