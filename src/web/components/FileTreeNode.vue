<script setup lang="ts">
import type { FileTreeNode } from '@/api/types'

const props = defineProps<{
  node: FileTreeNode
  selectedPath: string | null
  expandedFolders: Set<string>
  level: number
}>()

const emit = defineEmits<{
  (e: 'toggle-folder', path: string): void
  (e: 'file-select', path: string): void
}>()

const indent = 8 + props.level * 12
</script>

<template>
  <div class="file-tree-node">
    <q-item
      v-if="node.type === 'directory'"
      v-ripple
      clickable
      dense
      :style="{ paddingLeft: `${indent}px` }"
      @click="emit('toggle-folder', node.path)"
    >
      <q-item-section avatar class="file-tree-node__icon-section">
        <div class="row items-center no-wrap q-gutter-x-xs">
          <q-icon
            name="chevron_right"
            size="xs"
            class="file-tree-node__chevron"
            :class="{
              'file-tree-node__chevron--expanded': expandedFolders.has(
                node.path
              )
            }"
          />
          <q-icon
            :name="expandedFolders.has(node.path) ? 'folder_open' : 'folder'"
            size="xs"
            color="warning"
          />
        </div>
      </q-item-section>
      <q-item-section class="text-mono">
        <div class="ellipsis file-tree-node__label">
          {{ node.name }}
          <q-tooltip anchor="top middle" self="bottom middle">{{
            node.path
          }}</q-tooltip>
        </div>
      </q-item-section>
      <q-item-section
        v-if="node.children"
        side
        class="text-caption text-grey-6"
      >
        {{ node.children.length }}
      </q-item-section>
    </q-item>

    <q-item
      v-else
      v-ripple
      clickable
      dense
      :active="node.path === selectedPath"
      active-class="file-tree-node--selected"
      :style="{ paddingLeft: `${indent + 20}px` }"
      @click="emit('file-select', node.path)"
    >
      <q-item-section avatar class="file-tree-node__icon-section">
        <q-icon name="insert_drive_file" size="xs" color="grey-6" />
      </q-item-section>
      <q-item-section class="text-mono">
        <div class="ellipsis file-tree-node__label">
          {{ node.name }}
          <q-tooltip anchor="top middle" self="bottom middle">{{
            node.path
          }}</q-tooltip>
        </div>
      </q-item-section>
      <q-item-section v-if="node.isChanged" side>
        <q-icon name="fiber_manual_record" size="8px" color="warning" />
      </q-item-section>
    </q-item>

    <div
      v-if="
        node.type === 'directory' &&
        expandedFolders.has(node.path) &&
        node.children
      "
    >
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :expanded-folders="expandedFolders"
        :level="level + 1"
        @toggle-folder="emit('toggle-folder', $event)"
        @file-select="emit('file-select', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.file-tree-node__icon-section {
  min-width: 0 !important;
  padding-right: 6px !important;
}

.file-tree-node__label {
  width: 100%;
  min-width: 0;
}

.file-tree-node__chevron {
  transition: transform 0.15s ease;
}

.file-tree-node__chevron--expanded {
  transform: rotate(90deg);
}

.file-tree-node--selected {
  font-weight: 500;
}
</style>
