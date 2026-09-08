<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const browseMode = defineModel<boolean>({ default: false })
const { t } = useI18n()
</script>

<template>
  <q-item>
    <q-item-section>
      <q-item-label>
        {{ t('browse.toggle') }}
      </q-item-label>
    </q-item-section>
    <q-item-section side>
      <q-toggle v-model="browseMode" dense size="xs" />
    </q-item-section>
  </q-item>
</template>
