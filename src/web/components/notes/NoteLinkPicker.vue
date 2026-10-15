<script setup lang="ts">
import { noteTitle } from '../../../shared/notes/note-path.ts'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ paths: string[] }>()
const emit = defineEmits<{ select: [path: string] }>()
function select(path: string) {
  emit('select', path)
  open.value = false
}
const query = ref('')
const { t } = useI18n()
const { isDark } = useAppTheme()
const matches = computed(() =>
  props.paths.filter(path =>
    path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
  )
)
</script>
<template>
  <q-dialog v-model="open" @before-show="query = ''"
    ><q-card :dark="isDark" class="note-link-picker"
      ><q-card-section class="note-link-picker__search"
        ><q-input
          :dark="isDark"
          v-model="query"
          autofocus
          :label="t('notes.findLink')"
          @keydown.enter="matches[0] && select(matches[0])" /></q-card-section
      ><q-list dense class="note-link-picker__list scroll agent-menu"
        ><q-item
          v-for="path in matches"
          :key="path"
          clickable
          @click="select(path)"
          ><q-item-section
            ><q-item-label class="ellipsis">{{ noteTitle(path) }}</q-item-label
            ><q-item-label caption class="ellipsis">{{
              path
            }}</q-item-label></q-item-section
          ></q-item
        ><q-item v-if="!matches.length"
          ><q-item-section>{{ t('notes.noMatches') }}</q-item-section></q-item
        ></q-list
      ></q-card
    ></q-dialog
  >
</template>

<style scoped>
.note-link-picker {
  display: flex;
  flex-direction: column;
  width: 520px;
  max-width: 90vw;
  height: min(640px, calc(100dvh - 48px));
  overflow: hidden;
}
.note-link-picker__search {
  flex-shrink: 0;
}
.note-link-picker__list {
  flex: 1;
  min-height: 0;
}
.agent-menu .q-item__label.ellipsis {
  white-space: nowrap;
  overflow-wrap: normal;
}
.agent-menu .q-item__section {
  min-width: 0;
}
</style>
