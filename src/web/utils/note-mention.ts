import type { Node } from '@milkdown/kit/prose/model'
import { findMentionTrigger } from './mention-editor'

export function findNoteMentionTrigger(parent: Node, offset: number) {
  let start = 0
  // A link boundary permits a mention without a separating space.
  parent.forEach((node, position) => {
    const end = position + node.nodeSize
    if (end <= offset && node.marks.some(mark => mark.type.name === 'link')) {
      start = end
    }
  })
  const trigger = findMentionTrigger(
    parent.textBetween(start, offset, '\n', '\ufffc')
  )
  return trigger ? { ...trigger, start: start + trigger.start } : null
}
