<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
const router = useRouter()
const { t } = useI18n()
</script>
<template>
  <div class="row no-wrap">
    <q-btn
      flat
      round
      dense
      color="grey-7"
      icon="arrow_back"
      :aria-label="t('notes.back')"
      @click="router.back()"
    />
    <q-btn
      flat
      round
      dense
      color="grey-7"
      icon="arrow_forward"
      :aria-label="t('notes.forward')"
      @click="router.forward()"
    />
  </div>
</template>
