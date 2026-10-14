<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
const model = defineModel<string[]>({ required: true })
const props = defineProps<{
  options: string[]
  disabled?: boolean
  allowCreate?: boolean
  compact?: boolean
}>()
const query = ref('')
const filtered = computed(() =>
  props.options.filter(tag =>
    tag.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
  )
)
const { t } = useI18n()
const { isDark } = useAppTheme()
</script>
<template>
  <q-select
    :key="String(isDark)"
    :dark="isDark"
    v-model="model"
    :options="filtered"
    @filter="
      (value, update) =>
        update(() => {
          query = value
        })
    "
    :disable="disabled"
    multiple
    use-input
    use-chips
    :new-value-mode="allowCreate === false ? undefined : 'add-unique'"
    :label="compact ? undefined : t('notes.tags')"
    borderless
    dense
    hide-dropdown-icon
    :class="{ 'q-mb-md': !compact }"
  />
</template>
