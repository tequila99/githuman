<script setup lang="ts">
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
const basename = props.path.split('/').at(-1)!
const name = shallowRef(
  props.folder ? basename : basename.replace(/\.md$/i, '')
)
const parent = shallowRef(props.path.split('/').slice(0, -1).join('/'))
const busy = shallowRef(false)
const error = shallowRef('')
const valid = computed(
  () =>
    !!name.value.trim() &&
    !/[/\\\0]/.test(name.value.trim()) &&
    !name.value.trim().startsWith('.')
)
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
