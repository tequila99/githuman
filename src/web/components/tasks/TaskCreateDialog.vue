<script setup lang="ts">
import FormDialogCard from '@/components/FormDialogCard.vue'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { tasksApi } from '@/api/tasks'
import type { Task } from '@/api/types'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'

const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [task: Task] }>()
const { t } = useI18n()
const title = shallowRef('')
const busy = shallowRef(false)
const error = shallowRef<string | null>(null)
// A repeated submit of the same title reuses its request ID, so a retry cannot create two tasks.
let attempt: RequestAttempt | null = null

async function submit() {
  const text = title.value.trim()
  if (!text || busy.value) return
  const input = { title: text, state: 'open' as const }
  attempt = requestAttempt(attempt, input)
  busy.value = true
  error.value = null
  try {
    const task = await tasksApi.create(input, attempt.requestId)
    attempt = null
    open.value = false
    emit('created', task)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}
function reset() {
  title.value = ''
  error.value = null
  attempt = null
}
</script>
<template>
  <q-dialog v-model="open" :persistent="busy" @before-show="reset">
    <FormDialogCard
      :title="t('tasks.new')"
      :cancel-label="t('common.cancel')"
      :submit-label="t('common.create')"
      :busy="busy"
      :can-submit="Boolean(title.trim())"
      :error="error"
      @submit="submit"
      @cancel="open = false"
    >
      <q-input
        v-model="title"
        autofocus
        outlined
        maxlength="1000"
        :readonly="busy"
        :label="t('tasks.titleField')"
      />
    </FormDialogCard>
  </q-dialog>
</template>
