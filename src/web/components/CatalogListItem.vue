<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useAppTheme } from '@/composables/use-app-theme'

defineProps<{
  title: string
  selected?: boolean
  to?: RouteLocationRaw | undefined
}>()
const { isDark } = useAppTheme()
</script>

<template>
  <q-item
    role="listitem"
    :clickable="!to"
    :dark="isDark"
    class="catalog-list-item artifact-summary"
    :class="{ 'artifact-summary--dark': isDark }"
    :active="selected"
    :aria-current="selected ? 'true' : undefined"
  >
    <q-item-section v-if="$slots.icon" side class="catalog-list-item__icon">
      <slot name="icon" />
    </q-item-section>
    <q-item-section class="catalog-list-item__main">
      <q-item-label
        class="artifact-summary__title catalog-list-item__title ellipsis"
        :title="title"
      >
        <router-link v-if="to" :to="to">{{ title }}</router-link>
        <template v-else>{{ title }}</template>
      </q-item-label>
      <q-item-label
        v-if="$slots.metadata"
        caption
        class="artifact-summary__caption catalog-list-item__metadata"
      >
        <slot name="metadata" />
      </q-item-label>
    </q-item-section>
    <q-item-section v-if="$slots.side" side top>
      <slot name="side" />
    </q-item-section>
  </q-item>
</template>

<style scoped>
.catalog-list-item {
  min-width: 0;
  min-height: 60px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--app-divider);
}
.catalog-list-item.q-item--active {
  color: inherit;
  box-shadow: inset 3px 0 var(--q-primary);
  background-image: linear-gradient(
    var(--app-selection-tint),
    var(--app-selection-tint)
  );
}
.catalog-list-item:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.catalog-list-item__icon {
  min-width: 0;
  padding-right: 10px;
  color: var(--app-icon-neutral);
}
.catalog-list-item.q-item--active .catalog-list-item__icon {
  color: var(--q-primary);
}
.catalog-list-item__main {
  min-width: 0;
}
.catalog-list-item__title.ellipsis {
  white-space: nowrap;
  overflow-wrap: normal;
}
.catalog-list-item__metadata {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
  max-width: 100%;
}
</style>
