<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useAppTheme } from '@/composables/use-app-theme'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'

const emit = defineEmits<{
  (e: 'toggle-drawer'): void
}>()

const { t } = useI18n()
const { info } = storeToRefs(useRepositoryStore())
const { version } = storeToRefs(useAppInfoStore())
const { isDark } = useAppTheme()
const agentStore = useAgentStore()
const { enabled: agentEnabled, panelOpen: agentPanelOpen } =
  storeToRefs(agentStore)
</script>

<template>
  <q-header
    :class="isDark ? 'bg-dark text-white' : 'bg-white text-dark'"
    bordered
  >
    <q-toolbar>
      <q-btn
        v-ripple
        flat
        dense
        round
        icon="menu"
        :aria-label="t('nav.menu')"
        class="q-mr-sm"
        @click="emit('toggle-drawer')"
      />

      <q-toolbar-title shrink class="text-weight-bold gt-xs">
        {{ t('app.title') }}
      </q-toolbar-title>

      <q-badge v-if="version" outline rounded class="text-primary q-ml-xs">
        v{{ version }}
      </q-badge>

      <div
        v-if="info"
        class="row items-center q-gutter-x-sm text-body2 q-ml-md gt-sm repo-info"
        :class="isDark ? 'text-grey-5' : 'text-grey-7'"
      >
        <span class="text-weight-medium">{{ info.name }}</span>
        <template v-if="info.branch">
          <span>/</span>
          <q-badge outline class="text-body2 text-primary" rounded>
            {{ info.branch }}
          </q-badge>
        </template>
      </div>

      <q-space />
      <q-btn
        v-if="agentEnabled"
        v-ripple
        flat
        round
        dense
        :icon="AGENT_ICON"
        :color="agentPanelOpen ? 'primary' : undefined"
        :aria-label="t('nav.agent')"
        @click="agentPanelOpen = !agentPanelOpen"
      >
        <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ t('nav.agent') }}</q-tooltip>
      </q-btn>
    </q-toolbar>
  </q-header>
</template>

<style scoped>
.repo-info {
  line-height: 1;
}
</style>
