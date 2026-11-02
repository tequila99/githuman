<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ArtifactTransitionPreview } from '@/api/types'

defineProps<{ preview: ArtifactTransitionPreview }>()
const { t } = useI18n()
</script>

<template>
  <div class="q-mb-md">
    {{
      t('artifacts.transition.question', {
        title: preview.title,
        from: t('artifacts.statuses.' + preview.fromStatus),
        to: t('artifacts.statuses.' + preview.targetStatus)
      })
    }}
  </div>
  <div class="text-subtitle2">{{ t('artifacts.transition.changes') }}</div>
  <ul class="q-my-xs">
    <li v-for="change in preview.changes" :key="change.artifactId">
      {{
        t('artifacts.transition.change', {
          title: change.title,
          from: t('artifacts.statuses.' + change.fromStatus),
          to: t('artifacts.statuses.' + change.toStatus)
        })
      }}
    </li>
  </ul>
</template>
