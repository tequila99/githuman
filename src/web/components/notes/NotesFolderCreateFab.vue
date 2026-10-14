<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue'
import type { TouchPanValue } from 'quasar'
import { useI18n } from 'vue-i18n'
import { mdiFolderPlusOutline } from '@mdi/js'

type TouchPanDetails = Parameters<NonNullable<TouchPanValue>>[0]
const emit = defineEmits<{ create: [folder: boolean] }>()
const { t } = useI18n()
const panel = useTemplateRef<HTMLElement>('panel')
const fabPos = shallowRef<[number, number]>([48, 24])
const draggingFab = shallowRef(false)

function moveFab(event: TouchPanDetails) {
  draggingFab.value = event.isFirst !== true && event.isFinal !== true
  const bounds = panel.value?.getBoundingClientRect()
  if (!bounds) return
  fabPos.value = [
    Math.max(
      24,
      Math.min(bounds.width - 80, fabPos.value[0] - (event.delta?.x ?? 0))
    ),
    Math.max(
      24,
      Math.min(bounds.height - 80, fabPos.value[1] - (event.delta?.y ?? 0))
    )
  ]
}
</script>
<template>
  <div ref="panel" class="notes-folder-create-layer">
    <q-fab
      class="notes-folder-create"
      color="primary"
      icon="add"
      direction="up"
      vertical-actions-align="right"
      :style="{ right: fabPos[0] + 'px', bottom: fabPos[1] + 'px' }"
      :disable="draggingFab"
      v-touch-pan.prevent.mouse="moveFab"
      :aria-label="t('notes.newNote') + ' / ' + t('notes.newFolder')"
    >
      <q-fab-action
        color="primary"
        icon="add"
        :label="t('notes.newNote')"
        @click="emit('create', false)"
      />
      <q-fab-action
        color="primary"
        :icon="mdiFolderPlusOutline"
        :label="t('notes.newFolder')"
        @click="emit('create', true)"
      />
    </q-fab>
  </div>
</template>
<style scoped>
.notes-folder-create-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.notes-folder-create {
  position: absolute;
  z-index: 1;
  pointer-events: auto;
}
</style>
