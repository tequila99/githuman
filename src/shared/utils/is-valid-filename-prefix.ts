// Leave room for generated identifiers and suffixes in storage filenames.
const MAX_PREFIX_LENGTH = 100

// This checks a prefix, not a complete filename. An empty prefix is allowed.
export function isValidFilenamePrefix(prefix: string): boolean {
  if (prefix.length > MAX_PREFIX_LENGTH || /[<>:"/\\|?*]/.test(prefix)) {
    return false
  }
  for (let index = 0; index < prefix.length; index++) {
    if (prefix.charCodeAt(index) < 32) return false
  }
  return true
}
