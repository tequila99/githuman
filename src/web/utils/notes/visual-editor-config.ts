import type { Editor } from '@milkdown/kit/core'
import { linkSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { notesApi } from '@/api/notes'
import { errorMessage } from '@/utils/error-message'

export function configureNoteVisualEditor(
  editor: Editor,
  options: {
    disposed: () => boolean
    error: (message: string) => void
  }
) {
  editor.config(ctx => {
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
