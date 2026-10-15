<script setup lang="ts">
import {
  noteBasename,
  noteParentPath
} from '../../../shared/notes/note-path.ts'
import { validNoteEntryName } from '@/utils/notes/entry-name'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotesStore } from '@/stores/notes-store'
const props = defineProps<{ path: string; folder: boolean }>()
const emit = defineEmits<{
  close: []
  renamed: [path: string, target: string]
}>()
const store = useNotesStore()
const { t } = useI18n()
const basename = noteBasename(props.path)
const name = shallowRef(
  props.folder ? basename : basename.replace(/\.md$/i, '')
)
const parent = shallowRef(noteParentPath(props.path))
const busy = shallowRef(false)
const error = shallowRef('')
const valid = computed(() => validNoteEntryName(name.value))
async function submit() {
  if (!valid.value || busy.value) return
  busy.value = true
  const value = name.value.trim()
  const filename = props.folder || /\.md$/i.test(value) ? value : value + '.md'
  try {
    const target = [parent.value.trim(), filename].filter(Boolean).join('/')
    if (await store.rename(props.path, filename, props.folder, target)) {
      emit('renamed', props.path, target)
      emit('close')
    } else {
      error.value = store.error
    }
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <q-dialog :model-value="true" :persistent="busy" @hide="emit('close')">
    <q-card style="width: 360px; max-width: 90vw">
      <q-form @submit="submit">
        <q-card-section class="text-h6">{{ t('notes.rename') }}</q-card-section>
        <q-card-section>
          <q-input
            v-model="name"
            autofocus
            dense
            outlined
            :label="t('notes.newName')"
            :disable="busy"
          />
          <q-expansion-item
            dense
            :label="t('notes.moveFolder')"
            class="q-mt-sm"
          >
            <q-input
              v-model="parent"
              dense
              outlined
              :label="t('notes.destinationFolder')"
              :disable="busy"
              class="q-mt-sm"
            />
          </q-expansion-item>
          <div v-if="!valid" class="text-negative q-mt-sm">{{
            t('notes.invalidName')
          }}</div>
          <div v-if="error" role="alert" class="text-negative q-mt-sm">{{
            error
          }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            :label="t('notes.cancelRename')"
            :disable="busy"
            @click="emit('close')"
          />
          <q-btn
            color="primary"
            :label="t('notes.rename')"
            type="submit"
            :disable="!valid"
            :loading="busy"
          />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>
