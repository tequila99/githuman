<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ArtifactTransitionPreview } from '@/api/types'

defineProps<{
  blockers: ArtifactTransitionPreview['blockers']
  refreshed: boolean
  expired: boolean
  error: string | null
}>()
const { t } = useI18n()
</script>

<template>
  <q-banner
    v-if="blockers.length"
    dense
    class="bg-warning text-dark q-mt-sm"
    role="alert"
  >
    <div class="text-weight-medium">{{
      t('artifacts.transition.blocked')
    }}</div>
    <div v-for="item in blockers" :key="item.code + item.message">{{
      item.message
    }}</div>
    <div class="q-mt-xs">{{ t('artifacts.transition.blockedHint') }}</div>
  </q-banner>
  <q-banner v-if="refreshed" dense class="q-mt-sm" role="status">
    {{ t('artifacts.transition.refreshed') }}
  </q-banner>
  <q-banner v-if="expired" dense class="q-mt-sm" role="status">
    {{ t('artifacts.transition.expired') }}
  </q-banner>
  <q-banner v-if="error" dense class="text-negative q-mt-sm" role="alert">
    {{ t('artifacts.transition.startFailed') }}: {{ error }}
  </q-banner>
</template>
