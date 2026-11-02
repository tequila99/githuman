<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'

const tags = defineModel<string[]>('tags', { required: true })
const mode = defineModel<'all' | 'any'>('mode', { required: true })
const props = defineProps<{ options: string[]; allowCreate?: boolean }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const query = ref('')
const filtered = computed(() =>
  props.options.filter(tag =>
    tag.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
  )
)
</script>

<template>
  <q-select
    v-model="tags"
    :dark="isDark"
    :options="filtered"
    :label="t('common.filters.tags')"
    :hint="
      options.length || allowCreate ? undefined : t('common.filters.noTags')
    "
    :new-value-mode="allowCreate ? 'add-unique' : undefined"
    outlined
    dense
    multiple
    use-input
    use-chips
    @filter="
      (value, update) =>
        update(() => {
          query = value
        })
    "
  />
  <div
    v-if="tags.length > 1"
    role="radiogroup"
    :aria-label="t('common.filters.tagMode')"
  >
    <q-radio
      v-model="mode"
      :dark="isDark"
      val="all"
      :label="t('common.filters.allTags')"
    />
    <q-radio
      v-model="mode"
      :dark="isDark"
      val="any"
      :label="t('common.filters.anyTag')"
    />
  </div>
</template>
