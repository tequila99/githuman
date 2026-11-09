import type { Task, TaskInput, TaskLink } from './types.ts'

export type TaskFields = Pick<
  Task,
  'title' | 'state' | 'description' | 'links' | 'tags'
>

// Snapshots saved before stage 0127 have externalUrl and no description.
type StoredTask = Omit<Task, 'description' | 'links' | 'tags' | 'createdAt'> & {
  createdAt?: string
  description?: string
  tags?: string[]
  links?: TaskLink[]
  externalUrl?: string | null
}

// Older snapshots have no creation time; the caller passes the first version time.
export function normalizeStoredTask(
  stored: StoredTask,
  firstVersionAt = ''
): Task {
  const { externalUrl, ...task } = stored
  return {
    ...task,
    createdAt: task.createdAt ?? firstVersionAt,
    description: task.description ?? '',
    tags: task.tags ?? [],
    links: task.links ?? (externalUrl ? [{ url: externalUrl }] : [])
  }
}

function inputLinks(input: TaskInput): TaskLink[] | undefined {
  if (input.links !== undefined) {
    return input.links.map(({ url, label }) => {
      const text = label?.trim()
      return text ? { url: url.trim(), label: text } : { url: url.trim() }
    })
  }
  if (input.externalUrl === undefined) return undefined
  return input.externalUrl === null || input.externalUrl.trim() === ''
    ? []
    : [{ url: input.externalUrl.trim() }]
}

// Omitted optional fields keep the previous value; a new task starts empty.
export function resolveTaskFields(
  input: TaskInput,
  previous?: TaskFields
): TaskFields {
  return {
    title: input.title,
    state: input.state,
    description: input.description ?? previous?.description ?? '',
    links: inputLinks(input) ?? previous?.links ?? [],
    tags: input.tags ?? previous?.tags ?? []
  }
}
