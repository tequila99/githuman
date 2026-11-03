<script setup lang="ts">
import { mdiArrowLeft, mdiArrowRight } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
const router = useRouter()
const { t } = useI18n()
</script>
<template>
  <div class="row no-wrap">
    <q-btn
      class="app-icon-control"
      flat
      round
      dense
      :icon="mdiArrowLeft"
      :aria-label="t('notes.back')"
      @click="router.back()"
    />
    <q-btn
      class="app-icon-control"
      flat
      round
      dense
      :icon="mdiArrowRight"
      :aria-label="t('notes.forward')"
      @click="router.forward()"
    />
  </div>
</template>
