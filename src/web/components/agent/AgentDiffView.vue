<script setup lang="ts">
import { computed } from 'vue'
import { diffLines } from 'diff'
import { useI18n } from 'vue-i18n'
import type { AgentToolDiff } from '@/api/types'

// Keep large tool diffs from overwhelming the chat.
const MAX_LINES = 200
// Mark each row without repeating the mapping in the template.
const PREFIX = { added: '+', removed: '-', context: ' ' } as const

const props = defineProps<{ diff: AgentToolDiff }>()
const { t } = useI18n()

interface Row {
  type: 'added' | 'removed' | 'context'
  text: string
}

const rows = computed<{ rows: Row[]; hidden: number }>(() => {
  const all: Row[] = []
  for (const part of diffLines(props.diff.oldText ?? '', props.diff.newText)) {
    const type = part.added ? 'added' : part.removed ? 'removed' : 'context'
    // The last line of a part ends with "\n"; don't render it as an empty row.
    const lines = part.value.replace(/\n$/, '').split('\n')
    for (const text of lines) all.push({ type, text })
  }
  return {
    rows: all.slice(0, MAX_LINES),
    hidden: Math.max(0, all.length - MAX_LINES)
  }
})
</script>

<template>
  <div class="agent-diff">
    <div class="agent-diff__path text-mono text-caption">{{ diff.path }}</div>
    <pre class="agent-diff__body text-mono"><span
      v-for="(row, i) in rows.rows"
      :key="i"
      class="agent-diff__row"
      :class="`agent-diff__row--${row.type}`"
    >{{ PREFIX[row.type] }}{{ row.text }}
</span></pre>
    <div v-if="rows.hidden > 0" class="text-caption text-grey-6 q-pa-xs">
      … {{ rows.hidden }} more lines
    </div>
    <div v-if="diff.truncated" class="text-caption text-warning q-pa-xs">
      {{ t('agent.tool.diffTruncated') }}
    </div>
  </div>
</template>

<style scoped>
.agent-diff {
  border: 1px solid var(--q-separator-color, rgba(128, 128, 128, 0.3));
  border-radius: 4px;
}
.agent-diff__path {
  padding: 2px 8px;
  background: var(--diff-header-bg);
}
.agent-diff__body {
  margin: 0;
  max-width: 100%;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.45;
}
.agent-diff__row {
  display: block;
  padding: 0 8px;
  white-space: pre;
}
.agent-diff__row--added {
  background: rgba(46, 160, 67, 0.18);
}
.agent-diff__row--removed {
  background: rgba(248, 81, 73, 0.18);
}
</style>
