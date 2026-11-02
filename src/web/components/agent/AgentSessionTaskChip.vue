<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Task } from '@/api/types'
defineProps<{ id: string; task: Task | undefined; removable: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const { t } = useI18n()
</script>
<template>
  <q-chip
    dense
    size="sm"
    class="agent-session-tasks__task"
    :removable="removable"
    @remove="emit('remove')"
  >
    <span class="ellipsis" :title="task?.title ?? id">
      {{ task?.title ?? id
      }}<span v-if="task?.state === 'closed'">
        · {{ t('artifacts.definitions.closed') }}</span
      >
    </span>
  </q-chip>
</template>
<style scoped>
.agent-session-tasks__task {
  max-width: 100%;
  min-height: 28px;
}
.agent-session-tasks__task :deep(.q-chip__icon--remove) {
  box-sizing: border-box;
  align-self: center;
  width: 16px;
  height: 16px;
  margin-left: 4px;
  padding: 0;
  border-radius: 50%;
  font-size: 13px;
}
</style>
