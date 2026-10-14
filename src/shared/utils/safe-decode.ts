// Malformed escapes such as "%E0" throw URIError. Keep the raw text instead.
export function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
