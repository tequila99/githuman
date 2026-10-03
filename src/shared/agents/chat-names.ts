const normalize = (name: string) => name.trim().toLowerCase()

/**
 * `base` if no chat has that name yet, else `base (1)`, `base (2)`, … — the
 * first free one. Names compare without regard to case or surrounding blanks,
 * so open chats can always be told apart in the tabs and the menu.
 */
export function uniqueChatName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map(normalize))
  const wanted = base.trim()
  if (!used.has(normalize(wanted))) return wanted
  for (let n = 1; ; n++) {
    const candidate = `${wanted} (${n})`
    if (!used.has(normalize(candidate))) return candidate
  }
}
