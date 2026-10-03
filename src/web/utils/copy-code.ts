import { copyToClipboard, debounce } from 'quasar'

/** Keep successful copy feedback visible for this duration. */
export const COPIED_FEEDBACK_MS = 1500

interface CopyLabels {
  copy: string
  copied: string
}

/** Each Markdown owner cancels feedback when it replaces or removes its markup. */
export function createCodeBlockCopier(copy = copyToClipboard) {
  const resets = new Map<
    HTMLElement,
    { cancel: () => void; restore: () => void }
  >()
  let generation = 0

  function reset() {
    generation++
    for (const feedback of resets.values()) {
      feedback.cancel()
      feedback.restore()
    }
    resets.clear()
  }

  async function copyCodeBlock(
    button: HTMLElement,
    labels: CopyLabels
  ): Promise<boolean> {
    const current = generation
    const code = button
      .closest('.agent-code')
      ?.querySelector('pre')?.textContent
    try {
      // Quasar also supports clipboard access over plain HTTP in the LAN.
      await copy(code ?? '')
    } catch {
      return false
    }
    // A clipboard operation can finish after its owner has removed the markup.
    if (current !== generation) return true

    const previous = resets.get(button)
    if (previous) {
      previous.cancel()
    }
    button.dataset.copied = 'true'
    button.setAttribute('aria-label', labels.copied)
    const restore = () => {
      delete button.dataset.copied
      button.setAttribute('aria-label', labels.copy)
    }
    const delayedReset = debounce(() => {
      resets.delete(button)
      restore()
    }, COPIED_FEEDBACK_MS)
    resets.set(button, { cancel: () => delayedReset.cancel(), restore })
    delayedReset()
    return true
  }

  return { copyCodeBlock, reset }
}
