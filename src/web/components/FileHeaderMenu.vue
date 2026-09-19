<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const wrap = defineModel<boolean>({ required: true })

const { t } = useI18n()
</script>

<template>
  <q-btn
    v-ripple
    flat
    round
    dense
    size="sm"
    icon="more_vert"
    :aria-label="t('changes.fileActions')"
  >
    <q-menu>
      <q-list dense>
        <q-item v-close-popup clickable @click="wrap = !wrap">
          <q-item-section side>
            <q-icon :name="wrap ? 'check_box' : 'check_box_outline_blank'" />
          </q-item-section>
          <q-item-section>{{ t('changes.wrapLines') }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>
