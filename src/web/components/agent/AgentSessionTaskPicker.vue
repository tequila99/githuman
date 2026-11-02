<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArtifactDefinitionPicker from '@/components/artifacts/ArtifactDefinitionPicker.vue'
import AddButton from '@/components/buttons/AddButton.vue'

defineProps<{ storeId: string; disable: boolean }>()
const emit = defineEmits<{ add: [id: string] }>()
const { t } = useI18n()
const selected = defineModel<string | null>({ required: true })
function add() {
  if (!selected.value) return
  emit('add', selected.value)
  selected.value = null
}
</script>
<template>
  <div
    class="row items-start q-gutter-sm q-mt-sm agent-session-tasks__picker-row"
  >
    <ArtifactDefinitionPicker
      v-model="selected"
      class="col"
      :store-id="storeId"
      kind="task"
      popup-content-class="agent-menu agent-session-tasks-menu"
      :popup-content-style="{ fontFamily: 'var(--font-agent)' }"
      :disable="disable"
    />
    <AddButton
      size="sm"
      :tooltip="t('agent.tasks.add')"
      :disable="!selected || disable"
      @click="add"
    />
  </div>
</template>
<style scoped>
.agent-session-tasks__picker-row > .q-btn {
  width: 32px;
  min-height: 32px;
  margin-top: 12px;
}
</style>
