<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DiffFileStatus } from '@/api/types'
import type { DiffSource } from '@/stores/diff-store'
import FileCardHeader from '@/components/FileCardHeader.vue'
import FileHeaderMenu from '@/components/FileHeaderMenu.vue'
import CommentCountBadge from '@/components/CommentCountBadge.vue'

// Keep status colors consistent across this component.
const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: 'positive',
  modified: 'warning',
  deleted: 'negative',
  renamed: 'purple'
}

defineProps<{
  path: string
  status: DiffFileStatus
  additions: number
  deletions: number
  expanded: boolean
  commentCount: number
  /** Shows the "show full file" toggle. */
  fullFileToggle: boolean
  /** Which side of the diff the card shows — enables "add diff to agent chat" in the menu. */
  agentSource?: DiffSource | undefined
}>()

defineEmits<{ (e: 'toggle'): void }>()

const showFullFile = defineModel<boolean>('showFullFile', { required: true })
const wrap = defineModel<boolean>('wrap', { required: true })

const { t } = useI18n()
</script>

<template>
  <q-item
    v-ripple
    clickable
    dense
    class="diff-file-card__header-item"
    @click="$emit('toggle')"
  >
    <FileCardHeader :path="path">
      <template #leading>
        <q-icon
          name="chevron_right"
          size="xs"
          class="diff-file-card__chevron"
          :class="{ 'diff-file-card__chevron--expanded': expanded }"
        />
      </template>

      <template #badges>
        <CommentCountBadge compact :count="commentCount" />
      </template>

      <div
        v-if="fullFileToggle"
        class="diff-file-card__toggle-section"
        @click.stop
      >
        <q-toggle
          v-model="showFullFile"
          left-label
          dense
          size="xs"
          :label="t('changes.showFullFile')"
        />
      </div>

      <div class="diff-file-card__status-section">
        <q-badge :color="STATUS_COLOR[status]" outline rounded>
          {{ t(`changes.fileStatus.${status}`) }}
        </q-badge>
      </div>

      <span class="text-caption diff-file-card__stats">
        <span class="text-positive">+{{ additions }}</span>
        <span class="text-negative q-ml-xs">-{{ deletions }}</span>
      </span>

      <div @click.stop>
        <FileHeaderMenu
          v-model="wrap"
          :path="path"
          :diff-source="agentSource"
        />
      </div>
    </FileCardHeader>
  </q-item>
</template>

<style scoped>
.diff-file-card__header-item {
  padding: 0;
  min-height: 0;
}

.diff-file-card__chevron {
  transition: transform 0.15s ease;
}

.diff-file-card__chevron--expanded {
  transform: rotate(90deg);
}

.diff-file-card__toggle-section {
  display: flex;
  justify-content: flex-end;
  min-width: 160px;
}

.diff-file-card__status-section {
  display: flex;
  justify-content: flex-end;
  min-width: 92px;
}

.diff-file-card__stats {
  min-width: 76px;
  display: inline-block;
  text-align: right;
}
</style>
