// Platforms and browsers for a default device name, in match order.
const PLATFORMS: ReadonlyArray<[RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux']
]
// Browser match order keeps Chromium variants before Chrome and Safari.
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
]

/** "Safari on iPhone"; a generic name when the User-Agent says nothing known. */
export function deviceNameFromUserAgent(userAgent: string | undefined): string {
  const agent = userAgent ?? ''
  const platform = PLATFORMS.find(([pattern]) => pattern.test(agent))?.[1]
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1]
  if (browser && platform) return `${browser} on ${platform}`
  return browser ?? platform ?? 'Unknown device'
}
