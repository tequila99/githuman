<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiffFile, DiffFileStatus } from '@/api/types'
import type { DiffSource } from '@/stores/diff-store'
import DiffHunkView from '@/components/DiffHunkView.vue'
import DiffFileFullView from '@/components/DiffFileFullView.vue'
import FileCardFrame from '@/components/FileCardFrame.vue'
import FileCardHeader from '@/components/FileCardHeader.vue'
import {
  highlightFile,
  type HighlightedToken
} from '@/composables/use-syntax-highlighting'
import { pathOf } from '@/utils/diff-file'

const props = defineProps<{
  file: DiffFile
  source: DiffSource
  expanded: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'expand'): void
}>()

const { t } = useI18n()

const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: 'positive',
  modified: 'warning',
  deleted: 'negative',
  renamed: 'purple'
}

const path = computed(() => pathOf(props.file))

const viewMode = ref<'diff' | 'full'>('diff')

const showFullFile = computed({
  get: () => viewMode.value === 'full',
  set: (value: boolean) => {
    if (value) {
      viewMode.value = 'full'
      if (!props.expanded) emit('expand')
    } else if (props.expanded) {
      viewMode.value = 'diff'
    }
  }
})

const highlightedLines = ref<(HighlightedToken[] | null)[] | null>(null)

// Guards against out-of-order highlight results if `file` changes again
// before the previous highlightFile() call has resolved.
let latestHighlightRequestId = 0

watch(
  () => props.file,
  async file => {
    const requestId = ++latestHighlightRequestId
    viewMode.value = 'diff'
    highlightedLines.value = null
    const result = await highlightFile(file)
    if (requestId === latestHighlightRequestId) {
      highlightedLines.value = result
    }
  },
  { immediate: true }
)

function tokensForHunk(
  hunkIndex: number
): (HighlightedToken[] | null)[] | null {
  if (!highlightedLines.value) return null
  const offset = props.file.hunks
    .slice(0, hunkIndex)
    .reduce((sum, hunk) => sum + hunk.lines.length, 0)
  return highlightedLines.value.slice(
    offset,
    offset + props.file.hunks[hunkIndex]!.lines.length
  )
}
</script>

<template>
  <FileCardFrame :id="`diff-file-${path}`" class="diff-file-card">
    <template #header>
      <q-item
        v-ripple
        clickable
        dense
        class="diff-file-card__header-item"
        @click="emit('toggle')"
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

          <div class="diff-file-card__toggle-section" @click.stop>
            <q-toggle
              v-model="showFullFile"
              left-label
              dense
              size="xs"
              :label="t('changes.showFullFile')"
            />
          </div>

          <div class="diff-file-card__status-section">
            <q-badge :color="STATUS_COLOR[file.status]" outline rounded>
              {{ t(`changes.fileStatus.${file.status}`) }}
            </q-badge>
          </div>

          <span class="text-caption diff-file-card__stats">
            <span class="text-positive">+{{ file.additions }}</span>
            <span class="text-negative q-ml-xs">-{{ file.deletions }}</span>
          </span>
        </FileCardHeader>
      </q-item>
    </template>

    <div v-if="expanded" class="diff-file-card__body">
      <DiffFileFullView
        v-if="viewMode === 'full'"
        :path="path"
        :source="source"
      />
      <template v-else>
        <p
          v-if="file.isBinary"
          class="text-caption text-grey-6 q-pa-md q-mb-none"
        >
          {{ t('changes.binaryFile') }}
        </p>
        <p
          v-else-if="file.hunks.length === 0"
          class="text-caption text-grey-6 q-pa-md q-mb-none"
        >
          {{ t('changes.noTextChanges') }}
        </p>
        <DiffHunkView
          v-for="(hunk, index) in file.hunks"
          :key="index"
          :hunk="hunk"
          :line-tokens="tokensForHunk(index)"
        />
      </template>
    </div>
  </FileCardFrame>
</template>

<style scoped>
.diff-file-card {
  margin-bottom: 8px;
}

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

.diff-file-card__body {
  overflow-x: auto;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
