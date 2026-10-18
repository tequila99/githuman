/** Lifetime of a pairing request; the operator must approve it in this time (ADR 0079). */
export const PAIRING_REQUEST_TTL_MS = 2 * 60 * 1000

/** A trusted device without activity for this long loses access. */
export const DEVICE_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Activity writes to the database and renews the cookie at most this often. */
export const DEVICE_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Digits in the code that the operator compares on both screens. */
export const PAIRING_CODE_LENGTH = 6

/** Longest device name; the UI limits its input to the same length. */
export const DEVICE_NAME_MAX_LENGTH = 64

/** Pending requests at once, so that one LAN host cannot fill the database. */
export const MAX_PENDING_REQUESTS = 10

/** One client address may create a request at most this often. */
export const PAIRING_REQUEST_INTERVAL_MS = 10 * 1000

/** Requests from all addresses per minute: limits events and console messages. */
export const MAX_PAIRING_REQUESTS_PER_MINUTE = 30
