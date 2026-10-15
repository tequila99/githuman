import { safeDecodeURIComponent } from './safe-decode.ts'

/** True for `http:`/`https:` URLs without embedded credentials. */
export function isCredentialFreeWebUrl(url: URL): boolean {
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    !url.username &&
    !url.password
  )
}

/** Decoded last path segment; empty for a path that ends with a slash. */
export function webUrlLastSegment(url: URL): string {
  return safeDecodeURIComponent(url.pathname.split('/').at(-1) ?? '')
}

/** Decoded file name of the URL path, or the host name when the path has none. */
export function webUrlFileName(url: URL): string {
  return webUrlLastSegment(url) || url.hostname
}
