<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { INACTIVE_ARTIFACT_STATUSES } from '../../../shared/artifacts/constants.ts'
import { artifactsApi } from '@/api/artifacts'
import { tasksApi } from '@/api/tasks'
import type { Artifact, TaskArtifact } from '@/api/types'
import FormDialogCard from '@/components/FormDialogCard.vue'
import ArtifactStatusButton from '@/components/artifacts/ArtifactStatusButton.vue'
import { useServerEvents } from '@/composables/use-server-events'
import { errorMessage } from '@/utils/error-message'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  taskId: string
  busy: boolean
  error: string | null
}>()
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()
const items = shallowRef<TaskArtifact[]>([])
const documents = shallowRef(new Map<string, Artifact>())
const loadError = shallowRef<string | null>(null)
let generation = 0

const active = (item: TaskArtifact) =>
  !INACTIVE_ARTIFACT_STATUSES.includes(item.status)
// Artifacts bound only to this task must be archived before the task closes.
const required = computed(() =>
  items.value.filter(item => item.exclusive && active(item))
)
// Artifacts shared with other tasks stay the user's choice.
const optional = computed(() =>
  items.value.filter(item => !item.exclusive && active(item))
)

async function load() {
  const mine = ++generation
  try {
    const result = await tasksApi.artifacts(props.taskId)
    const fresh = new Map<string, Artifact>()
    // One unreadable document must not hide the others; its row simply has no status button.
    await Promise.allSettled(
      result.items
        .filter(active)
        .map(async item => fresh.set(item.id, await artifactsApi.get(item.id)))
    )
    if (mine !== generation) return
    items.value = result.items
    documents.value = fresh
    loadError.value = null
  } catch (err) {
    if (mine === generation) loadError.value = errorMessage(err)
  }
}
watch(open, value => value && void load())
const events = useServerEvents(['artifacts:changed'], () => {
  if (open.value) void load()
})
onBeforeUnmount(() => {
  events.close()
  generation++
})
</script>
<template>
  <q-dialog v-model="open" :persistent="busy">
    <FormDialogCard
      style="width: 560px; max-width: 92vw"
      :title="t('tasks.close.title')"
      :cancel-label="t('common.cancel')"
      :submit-label="t('tasks.close.confirm')"
      :busy="busy"
      :can-submit="required.length === 0 && !loadError"
      :error="error"
      @cancel="open = false"
      @submit="emit('confirm')"
    >
      <div class="text-grey q-mb-md">{{ t('tasks.close.hint') }}</div>
      <div class="column q-gutter-y-md scroll" style="max-height: 60vh">
        <div v-if="loadError" role="alert" class="text-negative">{{
          loadError
        }}</div>
        <section>
          <div class="text-subtitle2">{{ t('tasks.close.required') }}</div>
          <q-list v-if="required.length" dense separator>
            <q-item v-for="item in required" :key="item.id">
              <q-item-section class="ellipsis">{{ item.title }}</q-item-section>
              <q-item-section v-if="documents.get(item.id)" side>
                <ArtifactStatusButton :artifact="documents.get(item.id)!" />
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else class="text-grey">{{
            t('tasks.close.requiredDone')
          }}</div>
        </section>
        <section v-if="optional.length">
          <div class="text-subtitle2">{{ t('tasks.close.optional') }}</div>
          <div class="text-grey text-caption">{{
            t('tasks.close.optionalHint')
          }}</div>
          <q-list dense separator>
            <q-item v-for="item in optional" :key="item.id">
              <q-item-section class="ellipsis">{{ item.title }}</q-item-section>
              <q-item-section v-if="documents.get(item.id)" side>
                <ArtifactStatusButton :artifact="documents.get(item.id)!" />
              </q-item-section>
            </q-item>
          </q-list>
        </section>
      </div>
    </FormDialogCard>
  </q-dialog>
</template>
