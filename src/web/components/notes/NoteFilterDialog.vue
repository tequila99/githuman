<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import NoteTags from './NoteTags.vue'
import type { NoteTagMode } from '@/utils/note-navigation'
import type { NoteTagFilter } from '@/types/notes'
import { useAppTheme } from '@/composables/use-app-theme'

const open = defineModel<boolean>({ required: true })
const filter = defineModel<NoteTagFilter>('filter', { required: true })
const props = defineProps<{ options: [string, number][] }>()
const tagOptions = computed(() => props.options.map(([tag]) => tag))
const { t } = useI18n()
const { isDark } = useAppTheme()
const pendingTags = shallowRef<string[]>([])
const pendingMode = shallowRef<NoteTagMode>('all')
function prepare() {
  pendingTags.value = [...filter.value.tags]
  pendingMode.value = filter.value.mode
}
function reset() {
  pendingTags.value = []
  pendingMode.value = 'all'
}
function apply() {
  filter.value = { tags: [...pendingTags.value], mode: pendingMode.value }
  open.value = false
}
</script>

<template>
  <q-dialog v-model="open" @before-show="prepare">
    <q-card :dark="isDark" class="note-filter-dialog">
      <q-card-section class="text-h6">{{ t('notes.filter') }}</q-card-section>
      <q-card-section class="scroll" style="max-height: 55vh">
        <NoteTags
          v-model="pendingTags"
          :options="tagOptions"
          :allow-create="false"
        />
        <div
          v-if="pendingTags.length > 1"
          role="radiogroup"
          :aria-label="t('notes.tagMode')"
        >
          <q-radio
            :dark="isDark"
            v-model="pendingMode"
            val="all"
            :label="t('notes.allTags')"
          />
          <q-radio
            :dark="isDark"
            v-model="pendingMode"
            val="any"
            :label="t('notes.anyTag')"
          />
        </div>
        <p v-if="!options.length" class="text-grey">{{ t('notes.noTags') }}</p>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn
          flat
          :label="t('notes.resetFilter')"
          :disable="!pendingTags.length"
          @click="reset"
        />
        <q-btn flat color="primary" :label="t('notes.done')" @click="apply" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.note-filter-dialog {
  width: 420px;
  max-width: 90vw;
  font-family: var(--font-agent);
}
</style>
