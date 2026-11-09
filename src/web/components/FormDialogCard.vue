<script setup lang="ts">
import DialogHeader from '@/components/DialogHeader.vue'
import DialogButton from '@/components/buttons/DialogButton.vue'
import SubmitButton from '@/components/buttons/SubmitButton.vue'

defineProps<{
  title: string
  cancelLabel: string
  submitLabel: string
  busy?: boolean
  canSubmit?: boolean
  error?: string | null
}>()
defineEmits<{ submit: []; cancel: [] }>()
</script>

<template>
  <q-card class="form-dialog-card">
    <q-form @submit.prevent="!busy && canSubmit !== false && $emit('submit')">
      <DialogHeader
        :title="title"
        :close-label="cancelLabel"
        :disable-close="busy"
      />
      <q-card-section>
        <slot />
        <div v-if="error" role="alert" class="text-negative q-mt-sm">{{
          error
        }}</div>
      </q-card-section>
      <q-card-actions align="right">
        <DialogButton
          :disable="busy"
          :label="cancelLabel"
          @click="$emit('cancel')"
        />
        <SubmitButton
          :loading="busy"
          :disable="busy || canSubmit === false"
          :label="submitLabel"
        />
      </q-card-actions>
    </q-form>
  </q-card>
</template>

<style scoped>
.form-dialog-card {
  width: 440px;
  max-width: 90vw;
}
</style>
