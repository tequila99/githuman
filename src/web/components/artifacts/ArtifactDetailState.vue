<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ loading: boolean; error: string | null; stale: boolean }>()
const { t } = useI18n()
</script>
<template>
  <q-linear-progress v-if="loading" indeterminate />
  <div v-if="error" role="alert" class="q-pa-sm text-negative">{{ error }}</div>
  <div v-if="stale && !loading" role="status" class="q-pa-sm">{{
    t('artifacts.details.stale')
  }}</div>
</template>
