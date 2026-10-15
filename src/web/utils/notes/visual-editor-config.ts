import { remarkStringifyOptionsCtx, type Editor } from '@milkdown/kit/core'
import { linkSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { notesApi } from '@/api/notes'
import { errorMessage } from '@/utils/error-message'
import { startsLikeListMarker } from '@/utils/markdown'

export function configureNoteVisualEditor(
  editor: Editor,
  options: {
    disposed: () => boolean
    error: (message: string) => void
  }
) {
  editor.config(ctx => {
    // The default text handler skips escaping for plain text that ends in
    // whitespace, so "1. " before bold text would become a list.
    ctx.update(remarkStringifyOptionsCtx, previous => {
      const text = previous.handlers?.text
      return {
        ...previous,
        handlers: {
          ...previous.handlers,
          text: (node, parent, state, info) =>
            text && !startsLikeListMarker(node.value)
              ? text(node, parent, state, info)
              : state.safe(node.value, { ...info, encode: [] })
        }
      }
    })
    ctx.update(uploadConfig.key, previous => ({
      ...previous,
      uploader: async (files, schema) => {
        try {
          const images = Array.from(files).filter(file =>
            file.type.startsWith('image/')
          )
          const nodes = await Promise.all(
            images.map(async file => {
              const asset = await notesApi.uploadAsset(file)
              return schema.nodes.image!.create({
                src: asset.url,
                alt: file.name
              })
            })
          )
          if (!options.disposed()) options.error('')
          return options.disposed() ? [] : nodes
        } catch (err) {
          if (!options.disposed()) options.error(errorMessage(err))
          return []
        }
      }
    }))
  })
  // Text after a link must not inherit its target or suppress note suggestions.
  editor.use(
    linkSchema.extendSchema(previous => ctx => ({
      ...previous(ctx),
      inclusive: false
    }))
  )
  editor.use(
    paragraphSchema.extendSchema(previous => ctx => {
      const schema = previous(ctx)
      return {
        ...schema,
        toMarkdown: {
          ...schema.toMarkdown,
          runner: (state, node) => {
            // Empty paragraphs need no HTML placeholder in Markdown notes.
            if (node.content.size === 0) {
              state.openNode('paragraph').closeNode()
            } else {
              schema.toMarkdown.runner(state, node)
            }
          }
        }
      }
    })
  )
}
