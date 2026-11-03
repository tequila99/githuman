/**
 * Thin fetch wrapper for the githuman backend API.
 * In dev, /api is proxied to the backend (see quasar.config.ts devServer.proxy).
 */
import { isRecord } from '@/utils/guards'
import { reportAccessProblem } from '@/utils/access-problem'

export class ApiRequestError extends Error {
  readonly status: number
  /** Machine-readable server code, for example GHT_ARTIFACT_INTEGRITY; absent when the body has none. */
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

async function checkedFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(path, init)

  // A device can lose access at any time (revoke or expiry, ADR 0079).
  if (response.status === 401) reportAccessProblem()

  if (!response.ok) {
    // The server's JSON error body (see src/shared/http/types.ts ApiError) carries
    // a human-readable `message` (e.g. a ValidationError's text) — surface
    // it instead of a generic "status N" string whenever the body has one.
    const body = await response
      .clone()
      .json()
      .then((value: unknown) => (isRecord(value) ? value : null))
      .catch(() => null)
    const message =
      body !== null && 'message' in body ? String(body.message) : null
    const code =
      body !== null && typeof body.code === 'string' ? body.code : undefined

    throw new ApiRequestError(
      message ?? `Request failed with status ${response.status}`,
      response.status,
      code
    )
  }

  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await checkedFetch(path, init)

  // Not only 204: a 202 Accepted (agent prompt) is sent without a body too.
  const text = await response.text()
  if (text === '') {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- no body; caller's T must allow undefined
    return undefined as T
  }

  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- runtime JSON shape isn't checked; caller asserts the response contract
  return JSON.parse(text) as T
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal: signal ?? null })
}

/** GET of a raw text body, for example a markdown export. */
export async function apiGetText(path: string): Promise<string> {
  return (await checkedFetch(path)).text()
}

function withJsonBody(method: string, body: unknown): RequestInit {
  if (body === undefined) return { method }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  return request<T>(path, {
    ...withJsonBody('POST', body),
    signal: signal ?? null
  })
}

export async function apiPostBlob(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Blob> {
  return (
    await checkedFetch(path, {
      ...withJsonBody('POST', body),
      signal: signal ?? null
    })
  ).blob()
}

export function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  // The browser must set the multipart boundary in Content-Type.
  return request<T>(path, { method: 'POST', body })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, withJsonBody('PATCH', body))
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

export async function apiGetBlob(
  path: string,
  signal?: AbortSignal
): Promise<Blob> {
  return (await checkedFetch(path, { signal: signal ?? null })).blob()
}
