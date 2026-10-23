<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useAppTheme } from '@/composables/use-app-theme'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'
import { AppFullscreen, useQuasar } from 'quasar'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { useWorkspaceSwipe } from '@/composables/use-workspace-swipe'
import { useApplicationRegistry } from '@/stores/windows/application-registry'
import type { WindowApplication } from '@/types/windows/window'
import { errorMessage } from '@/utils/error-message'

const emit = defineEmits<{
  (e: 'toggle-drawer'): void
  (e: 'resize', height: number): void
}>()

const { t } = useI18n()
const $q = useQuasar()
const workspace = useWorkspaceNavigation()
const gestures = useWorkspaceSwipe()
const registry = useApplicationRegistry()
// The dock is hidden in the narrow layout, so the header starts the applications.
const launchers = computed(() =>
  registry.applications.filter(app => app.availability().enabled)
)
async function launch(application: WindowApplication) {
  try {
    await application.activate()
    if (application.id === 'terminal' || application.id === 'preview') {
      await workspace.openWindow(application.id)
    }
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  }
}
async function fullscreen() {
  try {
    await AppFullscreen.toggle()
  } catch {
    $q.notify({ type: 'negative', message: t('workspace.fullscreenFailed') })
  }
}
const { info } = storeToRefs(useRepositoryStore())
const { version } = storeToRefs(useAppInfoStore())
const { isDark } = useAppTheme()
const agentStore = useAgentStore()
const { enabled: agentEnabled, panelOpen: agentPanelOpen } =
  storeToRefs(agentStore)
</script>

<template>
  <q-header
    v-touch-swipe.horizontal="gestures.swipe"
    @touchstart="gestures.start"
    :class="isDark ? 'bg-dark text-white' : 'bg-white text-dark'"
    bordered
  >
    <q-resize-observer @resize="size => emit('resize', size.height)" />
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

      <q-toolbar-title shrink class="text-weight-bold ellipsis">
        {{ t('app.title') }}
      </q-toolbar-title>

      <q-badge
        v-if="version && !workspace.narrow.value"
        outline
        rounded
        class="text-primary q-ml-xs"
      >
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
      <template v-if="workspace.narrow.value">
        <q-btn
          v-for="application in launchers"
          :key="application.id"
          flat
          round
          :icon="application.icon"
          :aria-label="application.title()"
          @click="launch(application)"
        />
      </template>
      <q-btn
        v-if="AppFullscreen.isCapable"
        flat
        round
        :icon="AppFullscreen.isActive ? 'fullscreen_exit' : 'fullscreen'"
        :aria-label="
          t(
            AppFullscreen.isActive
              ? 'workspace.exitFullscreen'
              : 'workspace.fullscreen'
          )
        "
        @click="fullscreen"
      />
      <q-btn
        v-if="agentEnabled && !workspace.narrow.value"
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
