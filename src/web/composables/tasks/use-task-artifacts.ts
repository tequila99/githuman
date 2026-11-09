import {
  onBeforeUnmount,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar, uid } from 'quasar'
import { ARTIFACT_ERROR_CODES } from '../../../shared/artifacts/error-codes.ts'
import { ApiRequestError } from '@/api/client'
import { artifactsApi } from '@/api/artifacts'
import { tasksApi } from '@/api/tasks'
import type { ArtifactSearchItem, TaskArtifact } from '@/api/types'
import { useServerEvents } from '@/composables/use-server-events'
import { errorMessage } from '@/utils/error-message'

export function useTaskArtifacts(taskId: MaybeRefOrGetter<string>) {
  const { t } = useI18n()
  const $q = useQuasar()
  const items = shallowRef<TaskArtifact[]>([])
  const error = shallowRef<string | null>(null)
  const busy = shallowRef(false)
  let generation = 0

  async function load() {
    const mine = ++generation
    try {
      const result = await tasksApi.artifacts(toValue(taskId))
      if (mine !== generation) return
      items.value = result.items
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = errorMessage(err)
    }
  }
  watch(
    () => toValue(taskId),
    () => {
      // The list of the previous task must not show while the next one loads.
      items.value = []
      error.value = null
      void load()
    },
    { immediate: true }
  )
  async function rebind(id: string, change: (ids: string[]) => string[]) {
    if (busy.value) return
    busy.value = true
    try {
      const artifact = await artifactsApi.get(id)
      await tasksApi.setArtifactTasks(artifact, change(artifact.taskIds), uid())
      await load()
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : undefined
      const hint =
        code === ARTIFACT_ERROR_CODES.activeGraphChange
          ? t('tasks.artifacts.activeHint')
          : code === ARTIFACT_ERROR_CODES.taskClosed
            ? t('tasks.artifacts.closedHint')
            : undefined
      $q.notify({
        type: 'negative',
        message: errorMessage(err),
        ...(hint ? { caption: hint } : {})
      })
    } finally {
      busy.value = false
    }
  }
  async function add(item: ArtifactSearchItem) {
    const current = toValue(taskId)
    await rebind(item.id, ids => [...new Set([...ids, current])])
  }
  async function remove(item: TaskArtifact) {
    const current = toValue(taskId)
    await rebind(item.id, ids => ids.filter(id => id !== current))
  }
  const events = useServerEvents(['artifacts:changed'], () => void load())
  onBeforeUnmount(() => {
    events.close()
    generation++
  })
  return { items, error, busy, add, remove }
}
