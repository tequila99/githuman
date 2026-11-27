import type { Task } from '@/api/types'

export interface SessionTaskView {
  /** The first assigned task, or `null` when the chat has none. */
  id: string | null
  /** The task name, or the ID while the name is unknown. */
  title: string
  closed: boolean
  /** How many more tasks the assignment holds. */
  extra: number
}

/** A chat holds one task in the UI. Older data or MCP can assign more: show the first and count the rest. */
export function describeSessionTask(
  taskIds: readonly string[],
  find: (id: string) => Pick<Task, 'title' | 'state'> | undefined
): SessionTaskView {
  const id = taskIds[0] ?? null
  if (id === null) return { id, title: '', closed: false, extra: 0 }
  const task = find(id)
  return {
    id,
    title: task?.title ?? id,
    closed: task?.state === 'closed',
    extra: taskIds.length - 1
  }
}
