<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <q-btn
    padding="2px 8px"
    :label="t('reviews.create.submit')"
    v-bind="$attrs"
    unelevated
    dense
    color="accent"
  />
</template>
