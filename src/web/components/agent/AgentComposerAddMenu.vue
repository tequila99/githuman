<script setup lang="ts">
import AddButton from '@/components/buttons/AddButton.vue'
import { mdiAt, mdiFileUploadOutline } from '@mdi/js'
import { useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ files: [files: File[]]; mention: [] }>()
const { t } = useI18n()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
function onFilesPicked(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files) return
  emit('files', [...input.files])
  // Reset so choosing the same file fires change again.
  input.value = ''
}
</script>
<template>
  <div>
    <input
      ref="fileInput"
      type="file"
      multiple
      hidden
      @change="onFilesPicked"
    />
    <AddButton
      size="sm"
      class="q-ma-xs"
      :disable="disabled"
      :aria-label="t('agent.attach.menu')"
    >
      <q-menu anchor="top left" self="bottom left">
        <q-list dense class="agent-menu agent-add-menu">
          <q-item v-close-popup clickable @click="fileInput?.click()">
            <q-item-section avatar>
              <q-icon
                class="app-icon-neutral"
                :name="mdiFileUploadOutline"
                size="16px"
              />
            </q-item-section>
            <q-item-section>{{ t('agent.attach.uploadFile') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="emit('mention')">
            <q-item-section avatar>
              <q-icon class="app-icon-neutral" :name="mdiAt" size="16px" />
            </q-item-section>
            <q-item-section>{{ t('agent.attach.mentionFile') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </AddButton>
  </div>
</template>
<style scoped>
.agent-add-menu {
  min-width: 180px;
}
</style>
