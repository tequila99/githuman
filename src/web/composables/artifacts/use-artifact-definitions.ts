import type { ArtifactSearchItem } from '@/api/types'
import { watch, toValue, shallowRef, type MaybeRefOrGetter } from 'vue'
import {
  useArtifactDefinitionsStore,
  type createArtifactDefinitions
} from '@/stores/artifact-definitions-store'

export function useArtifactDefinitions(
  storeId: MaybeRefOrGetter<string | null>,
  visible: MaybeRefOrGetter<boolean>,
  items?: MaybeRefOrGetter<
    readonly Pick<ArtifactSearchItem, 'typeId' | 'taskIds'>[]
  >
) {
  const store = useArtifactDefinitionsStore()
  const definitions = shallowRef<ReturnType<
    typeof createArtifactDefinitions
  > | null>(null)
  watch(
    () => [toValue(storeId), toValue(visible)] as const,
    ([id, active], _previous, cleanup) => {
      definitions.value = id ? store.forStore(id) : null
      if (definitions.value && active) cleanup(definitions.value.retain())
    },
    { immediate: true }
  )
  watch(
    () =>
      [
        definitions.value,
        toValue(visible),
        items ? toValue(items) : []
      ] as const,
    ([value, active, entries]) => {
      if (value && active) void value.resolveCatalog(entries)
    },
    { immediate: true }
  )
  return definitions
}
