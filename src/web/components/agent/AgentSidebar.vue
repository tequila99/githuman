<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import AgentNewChatDialog from '@/components/agent/AgentNewChatDialog.vue'
import { useAppTheme } from '@/composables/use-app-theme'
import { usePanelWidth } from '@/composables/use-panel-width'

// The page must keep at least this much room next to the chat panel.
const MIN_PAGE_WIDTH = 360
// Keep chat controls usable when the panel is narrowed.
const MIN_PANEL_WIDTH = 320
// Provide room for chat messages before the user resizes the panel.
const INITIAL_PANEL_WIDTH = 440
// Limit chat width even when the window has more room.
const MAX_PANEL_WIDTH = 1000
// Switch the drawer to overlay mode on smaller windows.
const DRAWER_BREAKPOINT = 900

const { t } = useI18n()
const { panelOpen: agentPanelOpen } = storeToRefs(useAgentStore())
const { isDark } = useAppTheme()

const agentPanel = usePanelWidth({
  key: 'githuman.agentPanelWidth',
  initial: INITIAL_PANEL_WIDTH,
  min: MIN_PANEL_WIDTH,
  max: () =>
    Math.max(
      MIN_PANEL_WIDTH,
      Math.min(MAX_PANEL_WIDTH, window.innerWidth - MIN_PAGE_WIDTH)
    )
})
</script>

<template>
  <q-drawer
    v-model="agentPanelOpen"
    side="right"
    bordered
    :width="agentPanel.width.value"
    :breakpoint="DRAWER_BREAKPOINT"
    :dark="isDark"
    :class="{ 'agent-drawer--dragging': agentPanel.dragging.value }"
    class="agent-drawer"
  >
    <AgentChatPanel />
    <div
      v-touch-pan.preserveCursor.prevent.mouse.horizontal="agentPanel.drag"
      class="agent-drawer__handle"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="t('agent.resize')"
      :aria-valuenow="agentPanel.width.value"
      @keydown.left.prevent="agentPanel.nudge('wider')"
      @keydown.right.prevent="agentPanel.nudge('narrower')"
    />
  </q-drawer>

  <AgentNewChatDialog />
</template>

<style scoped>
/*
 * The visible border is the drawer's own `bordered` line, so the handle draws
 * nothing. Its grab area reaches 6px past the border on each side, like the
 * file list splitter. The drawer is the positioning parent: its content box is
 * static, so it does not clip the part that sticks out.
 */
.agent-drawer__handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -6px;
  z-index: 10;
  width: 13px;
  cursor: col-resize;
  touch-action: none;
}

.agent-drawer__handle:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

/* No width animation while dragging: the panel must follow the pointer. */
.agent-drawer--dragging {
  transition: none !important;
  user-select: none;
}
</style>
