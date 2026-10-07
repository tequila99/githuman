<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
<template>
  <q-banner dense class="bg-orange-2 text-dark text-caption">{{
    t('terminal.limited')
  }}</q-banner>
</template>
