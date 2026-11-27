import { computed, shallowRef, watch, onUnmounted } from 'vue'
import { useAgentStore } from '@/stores/agent-store'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { useArtifactDefinitions } from '@/composables/artifacts/use-artifact-definitions'
import { createSessionTaskEditor } from '@/utils/session-task-editor'
import { useServerEvents } from '@/composables/use-server-events'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'

export function useSessionTasks(props: { chatId: string; active: boolean }) {
  const agent = useAgentStore()
  const definitionsStore = useArtifactDefinitionsStore()
  const model = createSessionTaskEditor(props.chatId)
  const storeId = shallowRef<string | null>(null)
  const localError = shallowRef<string | null>(null)
  const info = computed(() => agent.chats[props.chatId]?.info)
  // The live status follows events. The status in `info` is a snapshot of the last list.
  const status = computed(() => agent.chats[props.chatId]?.chat.status)
  const canEdit = computed(
    () =>
      info.value &&
      info.value.status !== 'closed' &&
      !info.value.blockedBySessionId &&
      !info.value.reserved
  )
  // The agent answers with the task chosen at the start of the answer, so the choice waits.
  const editable = computed(
    () =>
      Boolean(canEdit.value) &&
      status.value === 'ready' &&
      !model.state.busy &&
      !model.state.loading &&
      !model.state.dirty &&
      Boolean(model.state.base)
  )
  const labels = computed(() =>
    storeId.value ? definitionsStore.forStore(storeId.value).taskLabels : null
  )
  const visible = computed(() => props.active)
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
  watch(
    visible,
    value => {
      if (value) {
        void load()
      } else {
        model.pause()
      }
    },
    { immediate: true }
  )
  watch(
    () => info.value?.taskIds,
    () => {
      if (props.active) void load()
    }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    if (!props.active) return
    void load()
  })
  async function reload() {
    await model.reload()
    await load()
  }
  async function select(id: string) {
    model.select(id)
    await save()
  }
  async function clear() {
    model.clear()
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
    storeId,
    localError,
    status,
    editable,
    labels,
    select,
    clear,
    save,
    reload
  }
}
