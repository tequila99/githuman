<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import AgentMentionEditor from './AgentMentionEditor.vue'
import AgentComposerContext from './AgentComposerContext.vue'
import AgentComposerAddMenu from './AgentComposerAddMenu.vue'
import AgentComposerSubmitButton from './AgentComposerSubmitButton.vue'
import AgentComposerSettings from './AgentComposerSettings.vue'
import AgentVoiceButton from './AgentVoiceButton.vue'
import { useNotifyError } from '@/composables/use-notify-error'
import { useAgentComposerConfig } from '@/composables/use-agent-composer-config'
import { useAgentAttachments } from '@/composables/use-agent-attachments'
import { useAgentAutoApprove } from '@/composables/use-agent-auto-approve'

const props = defineProps<{
  chatId: string
  /** The visible chat: a hidden one stops voice input. */
  active: boolean
}>()

const { t } = useI18n()
const store = useAgentStore()

const entry = computed(() => store.chats[props.chatId])
const status = computed(() => entry.value?.chat.status ?? 'closed')
const pending = computed(() => entry.value?.pendingContext ?? [])

const editor = useTemplateRef<InstanceType<typeof AgentMentionEditor>>('editor')
const isEmpty = shallowRef(true)

const notifyError = useNotifyError()
const {
  modelOption,
  modeOption,
  otherOptions,
  settingsLocked,
  changeConfig,
  cycleMode
} = useAgentComposerConfig(() => props.chatId)
const { attachFiles } = useAgentAttachments(() => props.chatId)
const { toggleAutoApprove } = useAgentAutoApprove(() => props.chatId)

async function send() {
  const targetEditor = editor.value
  const targetId = props.chatId
  const message = targetEditor?.serialize()
  if (!message || message.text === '') return
  try {
    const sent = await store.send(
      message.text,
      message.files.map(path => ({ kind: 'file' as const, path })),
      targetId
    )
    if (sent && props.chatId === targetId && editor.value === targetEditor) {
      targetEditor?.clear()
    }
  } catch (err) {
    notifyError(t('agent.sendFailed'), err)
  }
}

defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <div v-if="entry" class="agent-composer">
    <div class="agent-composer__box">
      <AgentComposerContext
        :items="pending"
        @remove="index => store.removeContext(index, chatId)"
      />
      <!-- Buttons stay on the bottom edge however tall the text grows. -->
      <div class="row no-wrap items-end">
        <AgentComposerAddMenu
          :disabled="status === 'closed'"
          @files="attachFiles"
          @mention="editor?.startMention()"
        />
        <AgentMentionEditor
          ref="editor"
          class="col"
          :disabled="status === 'closed'"
          :placeholder="t('agent.placeholder')"
          :label="t('agent.title')"
          :cycle-mode="modeOption !== undefined"
          @submit="send"
          @cycle-mode="cycleMode"
          @empty-change="empty => (isEmpty = empty)"
          @files="attachFiles"
        />

        <AgentVoiceButton
          :disabled="status === 'closed'"
          :active="active"
          @press="editor?.saveCaret()"
          @commit="text => editor?.insertText(text, active)"
        />

        <AgentComposerSubmitButton
          :status="status"
          :is-empty="isEmpty"
          @send="send"
          @cancel="store.cancel(chatId)"
        />
      </div>
    </div>

    <AgentComposerSettings
      :entry="entry"
      :model-option="modelOption"
      :mode-option="modeOption"
      :other-options="otherOptions"
      :settings-locked="settingsLocked"
      @select="changeConfig"
      @toggle-auto-approve="toggleAutoApprove"
    />
  </div>
</template>

<style scoped>
.agent-composer {
  flex: 0 0 auto;
  padding: 4px 16px 10px;
}
.agent-composer__box {
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 8px;
}
.agent-composer__box:focus-within {
  border-color: var(--q-primary);
}
</style>
