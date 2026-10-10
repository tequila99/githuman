<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type QScrollArea } from 'quasar'
import { useAgentStore } from '@/stores/agent-store'
import AgentChatItem from './AgentChatItem.vue'
import AgentChatBanners from './AgentChatBanners.vue'
import AgentComposer from './AgentComposer.vue'
import AgentPermissionCard from './AgentPermissionCard.vue'
import { useNotifyError } from '@/composables/use-notify-error'

// Allow a small gap when deciding whether to follow the feed.
const BOTTOM_THRESHOLD_PX = 24

const props = defineProps<{
  chatId: string
  /** The visible chat; the others stay mounted (drafts, scroll position) but hidden. */
  active: boolean
}>()

const { t } = useI18n()
const notifyError = useNotifyError()
const store = useAgentStore()

const entry = computed(() => store.chats[props.chatId])
const chat = computed(() => entry.value?.chat)
const preset = computed(() =>
  store.presets.find(p => p.id === entry.value?.info.presetId)
)
const busy = computed(() => chat.value?.status === 'busy')
const lastItem = computed(() => chat.value?.items.at(-1))
// After a failed turn the user usually just wants the agent to go on.
const canContinue = computed(
  () => lastItem.value?.kind === 'error' && chat.value?.status === 'ready'
)

const itemCount = computed(() => chat.value?.items.length ?? 0)
const permissionCount = computed(() => chat.value?.permissions.length ?? 0)
const lastTextLength = computed(() => {
  const item = lastItem.value
  return item && 'text' in item ? item.text.length : 0
})
const lastUserMessageId = computed(
  () => chat.value?.items.findLast(item => item.kind === 'user')?.id
)

const scroll = useTemplateRef<QScrollArea>('scroll')
const composer = useTemplateRef<InstanceType<typeof AgentComposer>>('composer')
// Follow new messages only while the user is at the bottom; a hidden chat
// reports bogus sizes, so only the visible one tracks it.
let atBottom = true
let lastTop = 0

function onScroll(info: {
  verticalPosition: number
  verticalSize: number
  verticalContainerSize: number
}) {
  if (!props.active) return
  // Size changes also emit scroll events; they do not mean the user scrolled away.
  if (info.verticalPosition === lastTop) {
    void followOutput()
    return
  }
  lastTop = info.verticalPosition
  atBottom =
    info.verticalPosition + info.verticalContainerSize >=
    info.verticalSize - BOTTOM_THRESHOLD_PX
}

function toBottom() {
  scroll.value?.setScrollPosition('vertical', Number.MAX_SAFE_INTEGER)
}

async function followOutput() {
  if (!props.active || !atBottom) return
  await nextTick()
  if (props.active && atBottom) toBottom()
}

watch([itemCount, permissionCount, lastTextLength], followOutput)
watch(lastUserMessageId, (id, previousId) => {
  if (!id || id === previousId || !props.active) return
  // A new user message starts a turn, even when the user was reading older messages.
  atBottom = true
  void followOutput()
})
watch(
  () => props.active,
  async active => {
    if (!active) return
    await nextTick()
    if (!props.active) return
    // A hidden element loses its scroll position: put it back.
    if (atBottom) {
      toBottom()
    } else {
      scroll.value?.setScrollPosition('vertical', lastTop)
    }
    composer.value?.focus()
  }
)

async function resume() {
  try {
    await store.send('Continue', [], props.chatId)
  } catch (err) {
    notifyError(t('agent.sendFailed'), err)
  }
}
</script>

<template>
  <div v-if="entry && chat" class="agent-view column no-wrap">
    <AgentChatBanners
      :auto-approves-edits="preset?.autoApprovesEdits ?? false"
      :auto-approve="chat.autoApprove"
      :review-stale="entry.reviewStale"
      :closed="chat.status === 'closed'"
      :error="entry.error"
      @disable-auto-approve="store.setAutoApprove(false, chatId)"
    />

    <!-- Messages never grow wider than the panel: prose wraps, and wide
         blocks (code, tables, diffs) scroll inside themselves. -->
    <q-scroll-area
      ref="scroll"
      class="col agent-view__scroll"
      @scroll="onScroll"
    >
      <div class="agent-view__feed">
        <q-resize-observer :debounce="0" @resize="followOutput" />
        <AgentChatItem
          v-for="item in chat.items"
          :key="item.id"
          :item="item"
          :chat-id="chatId"
          :can-continue="canContinue && item === lastItem"
          @continue="resume"
        />
        <AgentPermissionCard
          v-for="permission in chat.permissions"
          :key="permission.requestId"
          :permission="permission"
          @answer="
            optionId =>
              store.answerPermission(permission.requestId, optionId, chatId)
          "
        />
        <div
          v-if="busy && chat.permissions.length === 0"
          class="row justify-center"
        >
          <q-spinner-dots color="primary" size="24px" />
        </div>
      </div>
    </q-scroll-area>

    <AgentComposer ref="composer" :chat-id="chatId" />
  </div>
</template>

<style scoped>
.agent-view {
  position: absolute;
  inset: 0;
}
/* QScrollArea sizes its content to fit its widest child, so one long line or
   table would push everything past the panel edge; pin it to the panel width. */
.agent-view :deep(.q-scrollarea__content) {
  width: 100%;
}
.agent-view__feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}
</style>
