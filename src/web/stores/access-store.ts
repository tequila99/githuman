import { toIsoString } from '../../shared/utils/date.ts'
import { computed, ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet, apiPost } from '@/api/client'
import type { Access, AccessStatus } from '@/api/types'
import { errorMessage } from '@/utils/error-message'

/**
 * What the page shows (ADR 0079, item 11): the app, the pairing page, or
 * "the server is not available" for a network error, 5xx or a foreign Host.
 */
export type AccessMode = 'app' | 'pairing' | 'unavailable'

export function accessMode(status: AccessStatus | null): AccessMode {
  if (status === 'local' || status === 'device') return 'app'
  if (status === 'pending' || status === 'none') return 'pairing'
  return 'unavailable'
}

export const useAccessStore = defineStore('access', () => {
  const status = ref<AccessStatus | null>(null)
  const pairing = ref<Access['pairing'] | null>(null)
  // The deadline by the clock of this device: the server sends the time left.
  const pairingDeadline = ref<string | null>(null)
  const error = ref<string | null>(null)

  const mode = computed(() => accessMode(status.value))
  /** This machine: only it manages devices. */
  const isLocal = computed(() => status.value === 'local')

  function apply(access: Access) {
    status.value = access.status
    pairing.value = access.pairing ?? null
    pairingDeadline.value = access.pairing
      ? toIsoString(Date.now() + access.pairing.remainingMs)
      : null
    error.value = null
  }

  /** Reads the access of this browser. Returns null when the server is not available. */
  async function check(): Promise<AccessStatus | null> {
    try {
      apply(await apiGet<Access>('/api/access'))
    } catch (err) {
      // The pairing stays: a short network loss must not hide the code.
      status.value = null
      error.value = errorMessage(err)
    }
    return status.value
  }

  /** Starts a pairing request. Errors (429, network) go to the caller. */
  async function requestAccess(name?: string): Promise<void> {
    apply(await apiPost<Access>('/api/devices/requests', name ? { name } : {}))
  }

  return {
    status,
    pairing,
    pairingDeadline,
    error,
    mode,
    isLocal,
    check,
    requestAccess
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAccessStore, import.meta.hot))
}
