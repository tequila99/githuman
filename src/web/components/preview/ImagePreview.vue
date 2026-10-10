<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PreviewControls from './PreviewControls.vue'

const props = defineProps<{
  src: string
  title: string
  scale: number
  visible: boolean
  overlay: HTMLElement | null
}>()
const emit = defineEmits<{ rendered: []; zoom: [delta: number] }>()
const { t } = useI18n()
const failed = shallowRef(false)
const attempt = shallowRef(0)
watch(
  () => props.src,
  () => {
    failed.value = false
  }
)
function retry() {
  failed.value = false
  attempt.value++
}
</script>

<template>
  <div v-if="failed" class="q-pa-md text-negative">
    {{ t('windows.imageFailed') }}
    <q-btn flat :label="t('windows.retry')" @click="retry" />
  </div>
  <img
    v-else
    :key="attempt"
    class="preview-image"
    :src="src"
    :alt="title"
    :style="{ zoom: scale }"
    @load="emit('rendered')"
    @error="failed = true"
  />
  <Teleport v-if="overlay && visible && !failed" :to="overlay">
    <PreviewControls :scale="scale" @zoom="emit('zoom', $event)" />
  </Teleport>
</template>

<style scoped>
.preview-image {
  display: block;
  max-width: 100%;
  margin: 16px auto;
}
</style>
