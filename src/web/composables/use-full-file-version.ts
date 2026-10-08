import { shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

export interface FullFileVersion {
  lines: string[]
  kind: 'text' | 'empty' | 'binary' | 'deleted'
}

/** Errors and pending refetches retain the last successful content version. */
export function useFullFileVersion(options: {
  lines: MaybeRefOrGetter<string[]>
  isBinary: MaybeRefOrGetter<boolean>
  loaded: MaybeRefOrGetter<boolean>
  error: MaybeRefOrGetter<string | null>
  deleted: MaybeRefOrGetter<boolean>
}) {
  const version = shallowRef<FullFileVersion | null>(null)
  watch(
    [
      () => toValue(options.lines),
      () => toValue(options.isBinary),
      () => toValue(options.loaded),
      () => toValue(options.error),
      () => toValue(options.deleted)
    ],
    ([lines, binary, loaded, error, deleted]) => {
      if (!loaded || error) return
      const kind = deleted
        ? 'deleted'
        : binary
          ? 'binary'
          : lines.length
            ? 'text'
            : 'empty'
      if (version.value?.lines === lines && version.value.kind === kind) return
      version.value = { lines, kind }
    },
    { immediate: true }
  )
  return version
}
