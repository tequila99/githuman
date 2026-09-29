<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  message: string
  loading: boolean
}>()

const emit = defineEmits<{ (e: 'retry'): void }>()

const { t } = useI18n()
</script>

<template>
  <!-- role="none" overrides QBanner's own role="alert": only the text is
       live, the Retry spinner would be re-announced. -->
  <q-banner dense class="bg-negative text-white" role="none">
    <div role="alert">
      {{ title }}
      <div class="text-caption">{{ message }}</div>
    </div>
    <template #action>
      <q-btn
        flat
        dense
        color="white"
        :label="t('changes.retry')"
        :loading="loading"
        @click="emit('retry')"
      />
    </template>
  </q-banner>
</template>
