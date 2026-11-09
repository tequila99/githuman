<script setup lang="ts" generic="T">
import { computed, useTemplateRef, watch } from 'vue'
import type { QScrollArea } from 'quasar'

const props = withDefaults(
  defineProps<{
    items: T[]
    loading: boolean
    hasMore: boolean
    loadMore: () => Promise<void>
    disabled?: boolean
    resetKey?: string
    itemSize?: number
    offset?: number
  }>(),
  { disabled: false, itemSize: 60, offset: 300 }
)
defineSlots<{
  default(props: { item: T; index: number }): unknown
  empty(): unknown
}>()
const scrollArea = useTemplateRef<QScrollArea>('scrollArea')
const scrollTarget = computed(() => scrollArea.value?.getScrollTarget() ?? null)

async function load(_index: number, done: () => void) {
  try {
    await props.loadMore()
  } finally {
    done()
  }
}

// Filter changes start at the top; appended pages preserve the scroll position.
watch(
  () => props.resetKey,
  () => scrollArea.value?.setScrollPosition('vertical', 0)
)
</script>

<template>
  <q-scroll-area
    ref="scrollArea"
    class="virtual-infinite-list"
    content-style="width: 100%"
    content-active-style="width: 100%"
  >
    <q-infinite-scroll
      v-if="scrollTarget"
      :scroll-target="scrollTarget"
      :offset="offset"
      :disable="loading || disabled || !hasMore"
      @load="load"
    >
      <q-virtual-scroll
        :items="items"
        :scroll-target="scrollTarget"
        :virtual-scroll-item-size="itemSize"
        role="list"
      >
        <template #default="{ item, index }">
          <slot :item="item" :index="index" />
        </template>
      </q-virtual-scroll>
      <slot v-if="!items.length && !loading" name="empty" />
      <template #loading>
        <div class="row justify-center q-pa-sm">
          <q-spinner color="primary" />
        </div>
      </template>
    </q-infinite-scroll>
  </q-scroll-area>
</template>

<style scoped>
.virtual-infinite-list {
  min-width: 0;
  min-height: 0;
}
</style>
