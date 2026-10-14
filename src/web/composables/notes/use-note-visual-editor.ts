import {
  onMounted,
  onBeforeUnmount,
  ref,
  toValue,
  type MaybeRefOrGetter
} from 'vue'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  hasMarkdownImages,
  sameMarkdownContent,
  normalizeNoteEmptyParagraphs
} from '@/utils/markdown'
import { errorMessage } from '@/utils/error-message'
import { configureNoteVisualEditor } from '@/utils/notes/visual-editor-config'

export function useNoteVisualEditor(
  root: MaybeRefOrGetter<HTMLElement | null>,
  text: MaybeRefOrGetter<string>,
  options: {
    change: (text: string) => void
    unsupported: () => void
    ready: () => void
    link: () => void
    update: (view: EditorView) => void
    keydown: (view: EditorView, event: KeyboardEvent) => boolean
  }
) {
  const error = ref('')
  let editor: Crepe | undefined
  let disposed = false
  let ready = false
  let destruction: Promise<unknown> | undefined
  function destroyOnce() {
    ready = false
    destruction ??= editor?.destroy().catch(err => {
      if (!disposed) error.value = errorMessage(err)
    })
    return destruction
  }
  function getView() {
    return ready && editor
      ? editor.editor.action(ctx => ctx.get(editorViewCtx))
      : undefined
  }
  onMounted(async () => {
    const element = toValue(root)
    if (!element) return
    const initialText = toValue(text)
    if (hasMarkdownImages(initialText)) {
      options.unsupported()
      return
    }
    const normalized = normalizeNoteEmptyParagraphs(initialText)
    try {
      const instance = new Crepe({
        root: element,
        defaultValue: normalized,
        featureConfigs: {
          [Crepe.Feature.Toolbar]: {
            buildToolbar(builder) {
              for (const group of builder.build()) {
                const link = group.items.find(item => item.key === 'link')
                if (link) link.onRun = options.link
              }
            }
          }
        },
        features: {
          [Crepe.Feature.Latex]: false,
          [Crepe.Feature.ImageBlock]: false
        }
      })
      editor = instance
      configureNoteVisualEditor(instance.editor, {
        disposed: () => disposed,
        error: message => {
          error.value = message
        }
      })
      // Capture transactions synchronously so switching notes cannot lose the last keystroke.
      instance.editor.use(
        $prose(
          ctx =>
            new Plugin({
              props: { handleKeyDown: options.keydown },
              view: () => ({
                update(view, previous) {
                  if (!ready) return
                  options.update(view)
                  if (!view.state.doc.eq(previous.doc)) {
                    options.change(ctx.get(serializerCtx)(view.state.doc))
                  }
                }
              })
            })
        )
      )
      await instance.create()
      if (disposed) {
        await destroyOnce()
      } else if (!sameMarkdownContent(normalized, instance.getMarkdown())) {
        options.unsupported()
        await destroyOnce()
      } else {
        ready = true
        options.ready()
      }
    } catch (err) {
      if (!disposed) {
        error.value = errorMessage(err)
        options.unsupported()
      }
      await destroyOnce()
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    if (ready) void destroyOnce()
  })
  return { error, getView }
}
