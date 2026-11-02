import { computed, shallowRef, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { useArtifactDefinitions } from '@/composables/artifacts/use-artifact-definitions'
import { createSessionTaskEditor } from '@/utils/session-task-editor'
import { useServerEvents } from '@/composables/use-server-events'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'

export function useSessionTasks(props: { chatId: string; active: boolean }) {
  const { t } = useI18n()
  const agent = useAgentStore()
  const definitionsStore = useArtifactDefinitionsStore()
  const model = createSessionTaskEditor(props.chatId)
  const open = shallowRef(false)
  const storeId = shallowRef<string | null>(null)
  const localError = shallowRef<string | null>(null)
  const info = computed(() => agent.chats[props.chatId]?.info)
  const canEdit = computed(() => info.value && info.value.status !== 'closed')
  const labels = computed(() =>
    storeId.value ? definitionsStore.forStore(storeId.value).taskLabels : null
  )
  const inheritanceHint = computed(() => {
    const ids = model.state.snapshot?.taskIds ?? info.value?.taskIds ?? []
    const id = ids[0]
    if (!id) return t('agent.tasks.noInheritance')
    if (ids.length > 1) return t('agent.tasks.ambiguousInheritance')
    return t('agent.tasks.inheritance', {
      task: labels.value?.get(id)?.title ?? id
    })
  })
  const visible = computed(() => props.active && open.value)
  useArtifactDefinitions(() => storeId.value, visible)

  let disposed = false
  const load = singleFlight(async () => {
    if (!visible.value || disposed) return
    localError.value = null
    try {
      if (!storeId.value) {
        const definitions = await definitionsStore.current()
        if (disposed || !visible.value) return
        storeId.value = definitions.storeId
      }
      await model.refresh()
      if (disposed || !visible.value) return
      if (storeId.value) {
        const definitions = definitionsStore.forStore(storeId.value)
        await Promise.all(
          model.state.taskIds.map(id => definitions.resolve('task', id))
        )
      }
    } catch (error) {
      if (!disposed) localError.value = errorMessage(error)
    }
  })
  watch(visible, value => {
    if (value) {
      void load()
    } else {
      model.pause()
    }
  })
  watch(
    () => info.value?.taskIds,
    () => {
      if (open.value && props.active) void load()
    }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    if (!props.active || !open.value) return
    void load()
  })
  async function reload() {
    await model.reload()
    await load()
  }
  async function add(id: string) {
    if (model.state.taskIds.includes(id)) return
    model.setTasks([...model.state.taskIds, id])
    await save()
  }
  async function remove(id: string) {
    model.setTasks(model.state.taskIds.filter(item => item !== id))
    await save()
  }
  async function save() {
    try {
      await model.save()
    } catch {
      /* The editor retains the draft and error. */
    }
  }
  onUnmounted(() => {
    disposed = true
    events.close()
    model.dispose()
  })
  return {
    model,
    open,
    storeId,
    localError,
    info,
    canEdit,
    labels,
    inheritanceHint,
    add,
    remove,
    save,
    reload
  }
}
