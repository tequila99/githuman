<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SearchInput from './SearchInput.vue'

// ReviewsPage.vue watches these models and refetches on every change — this
// delays that until typing/picking pauses, instead of hitting the API on
// every keystroke. Only the free-text fields need it: `files` updates on
// discrete chip add/remove (not per keystroke), and QSelect has no
// `debounce` prop to take it anyway.
const FILTERS_DEBOUNCE_MS = 500

const search = defineModel<string | null>('search', { required: true })
const createdFrom = defineModel<string | null>('createdFrom', {
  required: true
})
const createdTo = defineModel<string | null>('createdTo', { required: true })
const files = defineModel<string[]>('files', { required: true })

const { t } = useI18n()
</script>

<template>
  <div class="review-filters q-pa-md q-gutter-y-sm">
    <SearchInput
      v-model="search"
      :debounce="FILTERS_DEBOUNCE_MS"
      :placeholder="t('reviews.filters.searchPlaceholder')"
    />
    <div class="row q-gutter-x-sm">
      <q-input
        v-model="createdFrom"
        dense
        outlined
        type="date"
        class="col"
        :debounce="FILTERS_DEBOUNCE_MS"
        :label="t('reviews.filters.from')"
      />
      <q-input
        v-model="createdTo"
        dense
        outlined
        type="date"
        class="col"
        :debounce="FILTERS_DEBOUNCE_MS"
        :label="t('reviews.filters.to')"
      />
    </div>
    <q-select
      v-model="files"
      dense
      outlined
      multiple
      use-input
      use-chips
      hide-dropdown-icon
      new-value-mode="add-unique"
      :label="t('reviews.filters.files')"
      :hint="t('reviews.filters.filesHint')"
    />
  </div>
</template>
