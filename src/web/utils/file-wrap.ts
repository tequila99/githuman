import { languageForPath } from '@/composables/use-syntax-highlighting'

export function isMarkdown(path: string): boolean {
  return languageForPath(path) === 'markdown'
}
