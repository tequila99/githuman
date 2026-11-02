<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  loading: boolean
  error: string | null
  stale?: boolean
  partial?: boolean
}>()
const { t } = useI18n()
</script>

<template>
  <q-linear-progress v-if="loading" indeterminate />
  <q-banner v-if="error" class="text-negative"
    >{{ error }}
    <div v-if="stale">{{ t('artifacts.stale') }}</div>
    <template v-if="$slots.action" #action><slot name="action" /></template>
  </q-banner>
  <q-banner v-if="partial">{{ t('artifacts.partial') }}</q-banner>
</template>
