<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { treeIndentPx } from '@/utils/file-tree'

defineProps<{
  /** The joined names of a compressed folder, `a/b/c`. */
  name: string
  /** Full path of the deepest folder, for the tooltip. */
  path: string
  depth: number
  expanded: boolean
  /** A filter shows every folder open, so the row cannot close. */
  locked: boolean
}>()
defineEmits<{ (e: 'toggle'): void }>()

const { t } = useI18n()
</script>

<template>
  <q-item
    v-ripple="!locked"
    :clickable="!locked"
    dense
    class="file-list-item diff-tree-folder-row"
    :style="{ paddingLeft: `${treeIndentPx(depth, false)}px` }"
    :aria-expanded="locked ? undefined : expanded"
    :aria-label="locked ? undefined : t('changes.listMode.folder', { path })"
    @click="$emit('toggle')"
  >
    <q-item-section avatar class="diff-tree-folder-row__icons">
      <div class="row items-center no-wrap q-gutter-x-xs">
        <q-icon
          name="chevron_right"
          size="xs"
          class="diff-tree-folder-row__chevron"
          :class="{
            'diff-tree-folder-row__chevron--expanded': expanded,
            invisible: locked
          }"
        />
        <q-icon
          :name="expanded ? 'folder_open' : 'folder'"
          size="xs"
          color="warning"
        />
      </div>
    </q-item-section>
    <q-item-section class="text-mono">
      <span class="ellipsis" :data-tooltip="path">{{ name }}</span>
    </q-item-section>
  </q-item>
</template>

<style scoped>
.diff-tree-folder-row__icons {
  min-width: 0 !important;
  padding-right: 6px !important;
}

.diff-tree-folder-row__chevron {
  transition: transform 0.15s ease;
}

.diff-tree-folder-row__chevron--expanded {
  transform: rotate(90deg);
}
</style>
