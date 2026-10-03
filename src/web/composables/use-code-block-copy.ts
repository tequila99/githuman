import { onBeforeUnmount, onDeactivated, watch, type WatchSource } from 'vue'
import { createCodeBlockCopier } from '@/utils/copy-code'

export function useCodeBlockCopy(markup: WatchSource<unknown>) {
  const copier = createCodeBlockCopier()
  watch(markup, copier.reset, { flush: 'sync' })
  onBeforeUnmount(copier.reset)
  onDeactivated(copier.reset)
  return copier
}
