<script setup lang="ts">
import { useAgentStore } from '@/stores/agent-store'
import {
  useAddAgentContext,
  type AgentContextSource
} from '@/composables/use-add-agent-context'
import { ADD_TO_CHAT_ICON } from '@/utils/agent-icon'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const props = defineProps<{
  context: AgentContextSource
  label: string
  text?: boolean
  tooltip?: boolean
}>()
const agent = useAgentStore()
const addContext = useAddAgentContext()
function add() {
  void addContext(props.context)
}
</script>
<template>
  <q-btn
    v-if="agent.enabled"
    class="app-icon-control"
    flat
    dense
    no-caps
    :round="!text"
    :icon="ADD_TO_CHAT_ICON"
    :label="text ? label : undefined"
    :aria-label="label"
    @click="add"
  >
    <q-tooltip v-if="tooltip" :delay="TOOLTIP_DELAY_MS">{{ label }}</q-tooltip>
  </q-btn>
</template>
