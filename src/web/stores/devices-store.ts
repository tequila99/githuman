import { computed, ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'
import type { Device } from '@/api/types'
import { useServerEvents } from '@/composables/use-server-events'
import { errorMessage } from '@/utils/error-message'
import { singleFlight } from '@/utils/single-flight'

/**
 * Pairing requests and trusted devices (ADR 0079). Only a local tab uses
 * this store: the server answers 403 to a device.
 */
export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<Device[]>([])
  const lanAddresses = ref<string[]>([])
  const error = ref<string | null>(null)
  let events: { close: () => void } | null = null

  const pending = computed(() =>
    devices.value.filter(device => device.state === 'pending')
  )
  const trusted = computed(() =>
    devices.value.filter(device => device.state === 'trusted')
  )

  const refresh = singleFlight(async () => {
    try {
      devices.value = await apiGet<Device[]>('/api/devices')
      error.value = null
    } catch (err) {
      error.value = errorMessage(err)
    }
  })

  /** Loads the list and follows `devices:changed`. A second call does nothing. */
  function start(): void {
    if (events) return
    events = useServerEvents(['devices:changed'], () => void refresh())
    void refresh()
  }

  async function loadLanAddresses(): Promise<void> {
    lanAddresses.value = await apiGet<string[]>('/api/devices/lan-addresses')
  }

  // Each action refreshes the list also after an error: 404, 409 and 410
  // mean that the list on the screen is out of date.
  /** The code is what the operator read on the device, not the stored one. */
  async function approve(device: Device, code: string): Promise<void> {
    try {
      await apiPost(`/api/devices/${encodeURIComponent(device.id)}/approve`, {
        code
      })
    } finally {
      await refresh()
    }
  }

  /** Rejects a pairing request or revokes a trusted device. */
  async function revoke(id: string): Promise<void> {
    try {
      await apiDelete(`/api/devices/${encodeURIComponent(id)}`)
    } finally {
      await refresh()
    }
  }

  async function rename(id: string, name: string): Promise<void> {
    try {
      await apiPatch(`/api/devices/${encodeURIComponent(id)}`, { name })
    } finally {
      await refresh()
    }
  }

  return {
    devices,
    lanAddresses,
    error,
    pending,
    trusted,
    refresh,
    start,
    loadLanAddresses,
    approve,
    revoke,
    rename
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDevicesStore, import.meta.hot))
}
