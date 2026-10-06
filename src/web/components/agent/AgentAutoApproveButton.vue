<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ enabled: boolean; disabled: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const label = computed(() =>
  t(
    props.enabled
      ? 'agent.autoApprove.tooltipOn'
      : 'agent.autoApprove.tooltipOff'
  )
)
</script>
<template>
  <q-btn
    flat
    round
    dense
    size="sm"
    :icon="enabled ? 'gpp_maybe' : 'shield'"
    :color="enabled ? 'warning' : undefined"
    :class="{ 'text-grey-6': !enabled }"
    :disable="disabled"
    :aria-pressed="enabled"
    :aria-label="label"
    @click="emit('toggle')"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ label }}</q-tooltip>
  </q-btn>
</template>
