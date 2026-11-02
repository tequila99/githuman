import { uid } from 'quasar'

export interface RequestAttempt {
  fingerprint: string
  requestId: string
}

export function requestAttempt(
  previous: RequestAttempt | null,
  payload: unknown
): RequestAttempt {
  const fingerprint = JSON.stringify(payload)
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, requestId: uid() }
}
