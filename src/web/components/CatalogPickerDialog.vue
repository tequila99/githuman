<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import DialogHeader from '@/components/DialogHeader.vue'

const open = defineModel<boolean>({ required: true })
const query = defineModel<string>('query', { required: true })
defineProps<{
  title: string
  searchLabel: string
  empty: boolean
  infinite?: boolean
  loading?: boolean
  hasMore?: boolean
  emptyLabel: string
}>()
const emit = defineEmits<{
  search: []
  searchEnter: []
  loadMore: [done: (stop?: boolean) => void]
}>()
const { t } = useI18n()
</script>

<template>
  <q-dialog v-model="open">
    <q-card class="catalog-picker-dialog column no-wrap">
      <DialogHeader :title="title" :close-label="t('common.filters.close')" />
      <q-card-section class="catalog-picker-dialog__search">
        <q-input
          v-model="query"
          autofocus
          outlined
          dense
          :label="searchLabel"
          @update:model-value="emit('search')"
          @keydown.enter="emit('searchEnter')"
        />
      </q-card-section>
      <slot name="filters" />
      <q-list class="catalog-picker-dialog__list col scroll" role="list">
        <q-infinite-scroll
          v-if="infinite"
          :disable="loading || !hasMore"
          :offset="200"
          @load="(_index, done) => emit('loadMore', done)"
        >
          <slot />
        </q-infinite-scroll>
        <slot v-else />
        <div v-if="loading" class="row justify-center q-pa-sm">
          <q-spinner color="primary" />
        </div>
        <q-item v-if="empty && !loading">
          <q-item-section class="text-grey">{{ emptyLabel }}</q-item-section>
        </q-item>
      </q-list>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.catalog-picker-dialog {
  width: 960px;
  max-width: 90vw;
  height: 80vh;
  max-height: 90vh;
}
.catalog-picker-dialog__search {
  flex-shrink: 0;
}
.catalog-picker-dialog__list {
  min-height: 0;
}
</style>
