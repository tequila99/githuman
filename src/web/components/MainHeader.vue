<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppTheme } from '@/composables/use-app-theme'

const emit = defineEmits<{
  (e: 'toggle-drawer'): void
}>()

const { t } = useI18n()
const { info } = storeToRefs(useRepositoryStore())
const { isDark, toggleTheme } = useAppTheme()
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

      <q-toolbar-title shrink class="text-weight-bold">
        {{ t('app.title') }}
      </q-toolbar-title>

      <div
        v-if="info"
        class="row items-center q-gutter-x-sm text-body2 q-ml-md gt-xs repo-info"
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

      <div class="row items-center gt-xs">
        <q-btn :to="{ path: '/' }" flat no-caps :label="t('nav.changes')" />
        <q-btn
          :to="{ path: '/reviews' }"
          flat
          no-caps
          :label="t('nav.reviews')"
        />

        <q-btn
          v-ripple
          flat
          round
          dense
          size="sm"
          :icon="isDark ? 'light_mode' : 'dark_mode'"
          :aria-label="
            isDark ? t('theme.switchToLight') : t('theme.switchToDark')
          "
          class="q-ml-xs"
          @click="toggleTheme"
        >
          <q-tooltip>{{
            isDark ? t('theme.switchToLight') : t('theme.switchToDark')
          }}</q-tooltip>
        </q-btn>
      </div>
    </q-toolbar>
  </q-header>
</template>

<style scoped>
.repo-info {
  line-height: 1;
}
</style>
