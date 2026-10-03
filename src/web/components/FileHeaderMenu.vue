<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import { useAddAgentContext } from '@/composables/use-add-agent-context'
import type { DiffSource } from '@/stores/diff-store'
import { ADD_TO_CHAT_ICON } from '@/utils/agent-icon'
import MarkdownPreviewDialog from './MarkdownPreviewDialog.vue'

const wrap = defineModel<boolean>({ required: true })

const props = defineProps<{
  /** Repository-relative path — enables "add to agent chat". */
  path?: string
  /** Set on a diff card: which side of the diff the file is on. */
  diffSource?: DiffSource | undefined
}>()

const { t } = useI18n()
const agent = useAgentStore()
const addToChat = useAddAgentContext()

const isMarkdown = computed(() => /\.(md|markdown)$/i.test(props.path ?? ''))
const previewOpen = ref(false)

function addFile() {
  if (props.path) addToChat({ kind: 'file', path: props.path })
}

function addDiff() {
  if (props.path && props.diffSource) {
    addToChat({
      kind: 'diff',
      source: props.diffSource,
      path: props.path
    })
  }
}
</script>

<template>
  <q-btn
    v-ripple
    flat
    round
    dense
    size="sm"
    icon="more_vert"
    :aria-label="t('changes.fileActions')"
  >
    <q-menu>
      <q-list dense class="agent-menu">
        <q-item v-close-popup clickable @click="wrap = !wrap">
          <q-item-section side>
            <q-icon :name="wrap ? 'check_box' : 'check_box_outline_blank'" />
          </q-item-section>
          <q-item-section>{{ t('changes.wrapLines') }}</q-item-section>
        </q-item>
        <q-item
          v-if="isMarkdown && path"
          v-close-popup
          clickable
          @click="previewOpen = true"
        >
          <q-item-section side><q-icon name="visibility" /></q-item-section>
          <q-item-section>{{ t('changes.previewMarkdown') }}</q-item-section>
        </q-item>
        <template v-if="agent.enabled && path">
          <q-separator />
          <q-item v-if="diffSource" v-close-popup clickable @click="addDiff">
            <q-item-section side
              ><q-icon :name="ADD_TO_CHAT_ICON"
            /></q-item-section>
            <q-item-section>{{ t('agent.context.addDiff') }}</q-item-section>
          </q-item>
          <q-item v-close-popup clickable @click="addFile">
            <q-item-section side
              ><q-icon :name="ADD_TO_CHAT_ICON"
            /></q-item-section>
            <q-item-section>{{ t('agent.context.addFile') }}</q-item-section>
          </q-item>
        </template>
      </q-list>
    </q-menu>
    <MarkdownPreviewDialog
      v-if="isMarkdown && path"
      v-model="previewOpen"
      :path="path"
    />
  </q-btn>
</template>
