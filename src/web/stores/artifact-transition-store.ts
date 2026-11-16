import { shallowReactive } from 'vue'
import { defineStore } from 'pinia'
import { artifactTransitionsApi as api } from '@/api/artifact-transitions'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'
import { safeStorage } from '@/utils/safe-storage'
import { isTerminalTransitionStage } from '../../shared/artifact-transitions/transitions.ts'
import type {
  ArtifactTransitionOperation,
  ArtifactTransitionOptions
} from '@/api/types'

// Only the preset ID is remembered; consent and documents never reach browser storage.
const PRESET_KEY = 'githuman:artifact-transition-preset:v1'

// A finished operation stays on screen this long; the full result remains in the validation report.
const RECENT_RESULT_MS = 10 * 60_000

export interface ArtifactTransitionEntry {
  options: ArtifactTransitionOptions | null
  operation: ArtifactTransitionOperation | null
  error: string | null
  /** True when the last read failed and `options` may be outdated. */
  stale: boolean
  loaded: boolean
}

// Shared read-only value for artifacts that were not loaded yet.
const EMPTY_ENTRY: ArtifactTransitionEntry = Object.freeze({
  options: null,
  operation: null,
  error: null,
  stale: false,
  loaded: false
})

export const useArtifactTransitionStore = defineStore(
  'artifact-transition',
  () => {
    const entries = shallowReactive(new Map<string, ArtifactTransitionEntry>())
    // Operations the user dismissed stay hidden; the server record is kept.
    const dismissed = new Set<string>()
    const attempts = new Map<string, RequestAttempt>()
    const readers = new Map<string, AbortController>()
    const loaders = new Map<string, () => Promise<void>>()
    // A read that started before a mutation must not overwrite its result.
    const mutations = new Map<string, number>()

    function mutationOf(artifactId: string): number {
      return mutations.get(artifactId) ?? 0
    }

    /** Marks a server-side change: aborts running reads and drops their results. */
    function mutated(artifactId: string) {
      mutations.set(artifactId, mutationOf(artifactId) + 1)
      readers.get(artifactId)?.abort()
    }

    function entry(artifactId: string): ArtifactTransitionEntry {
      return entries.get(artifactId) ?? EMPTY_ENTRY
    }

    function patch(artifactId: string, next: Partial<ArtifactTransitionEntry>) {
      entries.set(artifactId, { ...entry(artifactId), ...next })
    }

    function loader(artifactId: string) {
      const existing = loaders.get(artifactId)
      if (existing) {
        return existing
      }
      {
        const run = singleFlight(async () => {
          // A queued follow-up belongs to the pane that created this loader.
          if (loaders.get(artifactId) !== run) return
          readers.get(artifactId)?.abort()
          const controller = new AbortController()
          readers.set(artifactId, controller)
          const mutation = mutationOf(artifactId)
          try {
            const [options, operations] = await Promise.all([
              api.options(artifactId, controller.signal),
              api.operations(artifactId, controller.signal)
            ])
            if (
              controller.signal.aborted ||
              mutation !== mutationOf(artifactId)
            ) {
              return
            }
            const latest = operations.items[0] ?? null
            const hidden =
              latest !== null &&
              isTerminalTransitionStage(latest.stage) &&
              (dismissed.has(latest.id) ||
                Date.now() - latest.updatedAt >= RECENT_RESULT_MS)
            patch(artifactId, {
              options,
              operation: hidden ? null : latest,
              error: null,
              stale: false,
              loaded: true
            })
          } catch (error) {
            if (
              !controller.signal.aborted &&
              mutation === mutationOf(artifactId)
            ) {
              patch(artifactId, {
                error: errorMessage(error),
                stale: true,
                loaded: true
              })
            }
          }
        })
        loaders.set(artifactId, run)
        return run
      }
    }

    /** Reads menu data and the latest operation from the server. */
    function load(artifactId: string): Promise<void> {
      return loader(artifactId)()
    }

    /** Stops reads of an unmounted pane; the server operation keeps running. */
    function release(artifactId: string) {
      readers.get(artifactId)?.abort()
      readers.delete(artifactId)
      mutations.delete(artifactId)
      loaders.delete(artifactId)
    }

    /** Shows an accepted operation at once and blocks a second start. */
    function accept(
      artifactId: string,
      operation: ArtifactTransitionOperation
    ) {
      mutated(artifactId)
      const options = entry(artifactId).options
      patch(artifactId, {
        operation,
        error: null,
        ...(options
          ? {
              options: {
                ...options,
                activeOperationId: isTerminalTransitionStage(operation.stage)
                  ? null
                  : operation.id
              }
            }
          : {})
      })
    }

    function lastPreset(): string | null {
      return safeStorage.get(PRESET_KEY)
    }

    /** The one confirmation. A lost answer is retried with the same request ID. */
    async function begin(
      artifactId: string,
      previewId: string,
      presetId: string
    ) {
      const attempt = requestAttempt(attempts.get(artifactId) ?? null, {
        previewId,
        presetId
      })
      attempts.set(artifactId, attempt)
      try {
        const operation = await api.start(
          previewId,
          presetId,
          attempt.requestId
        )
        attempts.delete(artifactId)
        safeStorage.set(PRESET_KEY, presetId)
        dismissed.delete(operation.id)
        accept(artifactId, operation)
        return operation
      } finally {
        // A refused start (409) can mean another operation changed the state.
        void load(artifactId)
      }
    }

    async function cancel(artifactId: string, operationId: string) {
      try {
        const operation = await api.cancel(operationId)
        accept(artifactId, operation)
        return operation
      } finally {
        void load(artifactId)
      }
    }

    function dismiss(artifactId: string) {
      const current = entry(artifactId).operation
      if (current && isTerminalTransitionStage(current.stage)) {
        dismissed.add(current.id)
        patch(artifactId, { operation: null })
      }
    }

    return {
      entries,
      entry,
      load,
      release,
      previewFor: api.preview,
      lastPreset,
      begin,
      cancel,
      dismiss
    }
  }
)
