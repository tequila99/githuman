<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <q-btn
    padding="2px 8px"
    v-bind="$attrs"
    dense
    flat
    color="warning"
    :label="t('reviews.comments.cancel')"
  />
</template>
