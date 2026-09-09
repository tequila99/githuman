<script setup lang="ts">
const filter = defineModel<string | null>()
</script>

<template>
  <q-input v-model="filter" v-bind="$attrs" dense outlined clearable>
    <template #prepend>
      <q-icon name="search" size="xs" />
    </template>
  </q-input>
</template>
