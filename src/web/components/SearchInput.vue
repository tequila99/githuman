<script setup lang="ts">
import { mdiMagnify } from '@mdi/js'
const filter = defineModel<string | null>()
</script>

<template>
  <q-input v-model="filter" v-bind="$attrs" dense outlined clearable>
    <template #prepend>
      <q-icon class="app-icon-neutral" :name="mdiMagnify" size="xs" />
    </template>
  </q-input>
</template>
