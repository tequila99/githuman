import type { AgentContextItem } from '@/api/types'

type Translate = (key: string, named?: Record<string, unknown>) => string

export function contextLabel(item: AgentContextItem, t: Translate): string {
  if (item.kind === 'file') {
    return t('agent.context.file', { path: item.path })
  }
  if (item.kind === 'directory') {
    return t('agent.context.directory', { path: item.path })
  }
  if (item.kind === 'review') {
    return t('agent.context.review')
  }
  if (item.kind === 'attachment') {
    return t('agent.context.attachment', { name: item.name })
  }
  const source = t(`agent.source.${item.source}`)
  return item.path === undefined
    ? t('agent.context.diff', { source })
    : t('agent.context.diffFile', { source, path: item.path })
}
