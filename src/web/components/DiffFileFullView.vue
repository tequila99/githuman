<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileContent } from '@/composables/use-file-content'
import FileContentView from './FileContentView.vue'
import type { DiffSource } from '@/stores/diff-store'

const props = defineProps<{ path: string; source: DiffSource }>()

const { t } = useI18n()
const { lines, isBinary, loading, fetchContent } = useFileContent()

const targetRef = computed(() =>
  props.source === 'staged' ? 'INDEX' : 'WORKTREE'
)

watch(
  () => [props.path, targetRef.value] as const,
  ([path, ref]) => {
    void fetchContent(path, ref)
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="loading" class="row justify-center q-pa-lg">
    <q-spinner color="primary" size="2em" />
  </div>
  <p v-else-if="isBinary" class="text-caption text-grey-6 q-pa-md q-mb-none">
    {{ t('changes.binaryFile') }}
  </p>
  <FileContentView v-else :path="path" :lines="lines" />
</template>
