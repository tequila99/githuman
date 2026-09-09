<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'

const leftDrawerOpen = defineModel<boolean | null>({ required: true })

const { t } = useI18n()
const { isDark, toggleTheme } = useAppTheme()
</script>

<template>
  <q-drawer
    v-model="leftDrawerOpen"
    show-if-above
    bordered
    :width="220"
    :dark="isDark"
  >
    <div class="fit column no-wrap">
      <q-list class="col scroll">
        <q-item v-ripple clickable :to="{ path: '/' }">
          <q-item-section avatar>
            <q-icon name="compare_arrows" />
          </q-item-section>
          <q-item-section>{{ t('nav.changes') }}</q-item-section>
        </q-item>

        <q-item v-ripple clickable :to="{ path: '/reviews' }">
          <q-item-section avatar>
            <q-icon name="rate_review" />
          </q-item-section>
          <q-item-section>{{ t('nav.reviews') }}</q-item-section>
        </q-item>
      </q-list>

      <q-list bordered :dark="isDark">
        <q-item v-ripple clickable @click="toggleTheme">
          <q-item-section avatar>
            <q-icon :name="isDark ? 'light_mode' : 'dark_mode'" />
          </q-item-section>
          <q-item-section>
            {{ isDark ? t('theme.switchToLight') : t('theme.switchToDark') }}
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </q-drawer>
</template>
