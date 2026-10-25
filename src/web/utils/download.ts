import { exportFile } from 'quasar'
import { apiGetBlob } from '@/api/client'

/** Fetches a file from the API and saves it, so a failed request shows an error. */
export async function downloadFile(
  url: string,
  name: string,
  signal?: AbortSignal
): Promise<void> {
  const blob = await apiGetBlob(url, signal)
  signal?.throwIfAborted()
  // exportFile returns the error instead of throwing it.
  const result = exportFile(name, blob, blob.type || undefined)
  if (result !== true) throw result
}
