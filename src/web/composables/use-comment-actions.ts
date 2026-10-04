import { inject, provide, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CreateCommentRequest } from '@/api/types'
import { useNotifyError } from '@/composables/use-notify-error'

/**
 * What the comment components can do with comments. Each action resolves when the
 * server accepted it and rejects when it failed. A form clears its text only after
 * success, so a failed send keeps the text.
 */
export interface CommentActions {
  create(input: CreateCommentRequest): Promise<void>
  edit(id: string, content: string): Promise<void>
  remove(id: string): Promise<void>
  resolve(id: string): Promise<void>
  unresolve(id: string): Promise<void>
}

/**
 * The page or the card above the comment components provides the actions. Before,
 * every action was an event passed up through five components.
 */
export const COMMENT_ACTIONS_KEY: InjectionKey<CommentActions> =
  Symbol('comment-actions')

/** Store methods behind the actions. They may resolve with the changed comment. */
export type CommentActionSource = {
  [K in keyof CommentActions]: (
    ...args: Parameters<CommentActions[K]>
  ) => Promise<unknown>
}

/**
 * Provides `actions` to the comment components below. A failed action shows a
 * notification and then rejects, so the caller keeps its form open.
 */
export function provideCommentActions(actions: CommentActionSource) {
  const { t } = useI18n()
  const notifyError = useNotifyError()

  function notifying<A extends unknown[]>(
    action: (...args: A) => Promise<unknown>
  ) {
    return async (...args: A) => {
      try {
        await action(...args)
      } catch (err) {
        notifyError(t('reviews.comments.error'), err)
        throw err
      }
    }
  }

  provide(COMMENT_ACTIONS_KEY, {
    create: notifying(actions.create),
    edit: notifying(actions.edit),
    remove: notifying(actions.remove),
    resolve: notifying(actions.resolve),
    unresolve: notifying(actions.unresolve)
  })
}

async function missing(): Promise<void> {
  throw new Error('No comment actions are provided here')
}

/**
 * The actions of the enclosing page or card. Views without comments (browse mode)
 * have no provider: an action there rejects.
 */
export function useCommentActions(): CommentActions {
  const provided = inject(COMMENT_ACTIONS_KEY, undefined)
  if (provided) return provided
  return {
    create: missing,
    edit: missing,
    remove: missing,
    resolve: missing,
    unresolve: missing
  }
}

/** Runs an action whose error the provider already showed. */
export function ignoreShownError(action: Promise<void>): void {
  action.catch(() => undefined)
}
