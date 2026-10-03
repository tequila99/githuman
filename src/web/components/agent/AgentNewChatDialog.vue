<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import { uniqueChatName } from '@/api/types'
import AgentContextChip from './AgentContextChip.vue'

const { t } = useI18n()
const store = useAgentStore()
const { presets, newChatDialog, creating, error } = storeToRefs(store)

const open = computed({
  get: () => newChatDialog.value.open,
  set: value => {
    if (!value) store.closeNewChatDialog()
  }
})

const presetId = ref<string | null>(null)
const name = ref('')
// Until the user types a name, it follows the chosen agent ("pi", "pi 2", …).
const nameEdited = ref(false)

const presetOptions = computed(() =>
  presets.value.map(p => ({
    value: p.id,
    label: p.available ? p.title : `${p.title} (${t('agent.unavailable')})`,
    disable: !p.available
  }))
)
const chosen = computed(
  () => presets.value.find(p => p.id === presetId.value) ?? null
)

function suggestedName(): string {
  return chosen.value
    ? uniqueChatName(
        chosen.value.title,
        store.list.map(entry => entry.info.name)
      )
    : ''
}

watch(open, isOpen => {
  if (!isOpen) return
  presetId.value =
    presets.value.find(p => p.id === presetId.value && p.available)?.id ??
    presets.value.find(p => p.available)?.id ??
    null
  nameEdited.value = false
  name.value = suggestedName()
  error.value = null
})
watch(presetId, () => {
  if (!nameEdited.value) name.value = suggestedName()
})

async function create() {
  if (!presetId.value || creating.value) return
  try {
    await store.createChat(
      presetId.value,
      name.value.trim() || suggestedName(),
      newChatDialog.value.context
    )
    store.closeNewChatDialog()
  } catch {
    // The reason is in `error`, shown in the dialog.
  }
}
</script>

<template>
  <q-dialog v-model="open">
    <q-card class="agent-new-chat">
      <q-form @submit.prevent="create">
        <q-card-section class="text-h6">
          {{ t('agent.newChat.title') }}
        </q-card-section>
        <q-card-section class="column q-gutter-y-md q-pt-none">
          <q-input
            v-model="name"
            autofocus
            dense
            outlined
            maxlength="60"
            :label="t('agent.newChat.name')"
            @update:model-value="nameEdited = true"
          />
          <q-select
            v-model="presetId"
            dense
            outlined
            emit-value
            map-options
            :label="t('agent.newChat.agent')"
            :options="presetOptions"
          />
          <div v-if="newChatDialog.context.length > 0">
            <div class="text-caption text-grey-6 q-mb-xs">
              {{ t('agent.newChat.context') }}
            </div>
            <AgentContextChip
              v-for="(item, i) in newChatDialog.context"
              :key="i"
              :item="item"
            />
          </div>
          <div v-if="error" class="text-negative text-caption">{{ error }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            v-close-popup
            flat
            no-caps
            :label="t('agent.newChat.cancel')"
          />
          <q-btn
            type="submit"
            color="primary"
            unelevated
            no-caps
            :loading="creating"
            :disable="!presetId"
            :label="t('agent.newChat.create')"
          />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.agent-new-chat {
  width: 380px;
  max-width: 92vw;
}
</style>
