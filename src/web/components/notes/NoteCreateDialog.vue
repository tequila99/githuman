<script setup lang="ts">
import { shallowRef } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import { useI18n } from 'vue-i18n'
import FormDialogCard from '@/components/FormDialogCard.vue'
import { validNoteEntryName } from '@/utils/notes/entry-name'

defineProps<{
  title: string
  message: string
  copy: boolean
  folder: boolean
}>()
defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } =
  useDialogPluginComponent()
const { t } = useI18n()
const name = shallowRef('')

function submit() {
  if (validNoteEntryName(name.value)) onDialogOK(name.value)
}
</script>

<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <FormDialogCard
      :title="title"
      :cancel-label="t('common.cancel')"
      :submit-label="t(copy && !folder ? 'notes.saveCopy' : 'common.create')"
      :can-submit="validNoteEntryName(name)"
      @submit="submit"
      @cancel="onDialogCancel"
    >
      <p>{{ message }}</p>
      <q-input v-model="name" autofocus outlined :aria-label="title" />
    </FormDialogCard>
  </q-dialog>
</template>
