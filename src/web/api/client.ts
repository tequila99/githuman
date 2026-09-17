/**
 * Thin fetch wrapper for the githuman backend API.
 * In dev, /api is proxied to the backend (see quasar.config.ts devServer.proxy).
 */

export class ApiRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)

  if (!response.ok) {
    // The server's JSON error body (see src/shared/types.ts ApiError) carries
    // a human-readable `message` (e.g. a ValidationError's text) — surface
    // it instead of a generic "status N" string whenever the body has one.
    const message = await response
      .clone()
      .json()
      .then((body: unknown) =>
        body && typeof body === 'object' && 'message' in body
          ? String(body.message)
          : null
      )
      .catch(() => null)

    throw new ApiRequestError(
      message ?? `Request failed with status ${response.status}`,
      response.status
    )
  }

  if (response.status === 204) {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- 204 has no body; caller's T must allow undefined
    return undefined as T
  }

  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- runtime JSON shape isn't checked; caller asserts the response contract
  return (await response.json()) as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

function withJsonBody(method: string, body: unknown): RequestInit {
  if (body === undefined) return { method }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, withJsonBody('POST', body))
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, withJsonBody('PATCH', body))
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
