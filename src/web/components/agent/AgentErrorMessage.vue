<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ text: string; canContinue?: boolean }>()
const emit = defineEmits<{ continue: [] }>()
const { t } = useI18n()
</script>

<template>
  <q-banner dense rounded class="agent-item bg-negative text-white">
    {{ text }}
    <template v-if="canContinue" #action>
      <q-btn
        flat
        dense
        no-caps
        :label="t('agent.continue')"
        @click="emit('continue')"
      />
    </template>
  </q-banner>
</template>
