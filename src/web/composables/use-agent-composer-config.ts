import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import type { AgentConfigOption } from '@/api/types'
import { nextOptionValue, optionByCategory } from '@/utils/agent-config'
import { useNotifyError } from './use-notify-error'

export function useAgentComposerConfig(chatId: MaybeRefOrGetter<string>) {
  const store = useAgentStore()
  const { t } = useI18n()
  const notifyError = useNotifyError()
  const entry = computed(() => store.chats[toValue(chatId)])
  const options = computed(() => entry.value?.chat.config ?? [])
  const status = computed(() => entry.value?.chat.status ?? 'closed')
  // Model and mode lead; whatever else the agent offers (thinking level, …) follows.
  const modelOption = computed(() => optionByCategory(options.value, 'model'))
  const modeOption = computed(() => optionByCategory(options.value, 'mode'))
  const otherOptions = computed(() =>
    options.value.filter(o => o !== modelOption.value && o !== modeOption.value)
  )
  const settingsLocked = computed(() => status.value !== 'ready')

  async function changeConfig(
    option: AgentConfigOption,
    value: string | boolean
  ) {
    try {
      await store.setConfig(option.id, value, toValue(chatId))
    } catch (err) {
      notifyError(t('agent.config.failed', { name: option.name }), err)
    }
  }

  /** Shift+Tab in the input: the next mode. */
  function cycleMode() {
    const option = modeOption.value
    if (!option || settingsLocked.value) return
    const next = nextOptionValue(option)
    if (next !== undefined) void changeConfig(option, next)
  }

  return {
    modelOption,
    modeOption,
    otherOptions,
    settingsLocked,
    changeConfig,
    cycleMode
  }
}
