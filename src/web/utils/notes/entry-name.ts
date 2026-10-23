export function validNoteEntryName(value: string): boolean {
  const name = value.trim()
  return (
    Boolean(name) &&
    name.length <= 255 &&
    !/[/\\\0]/.test(name) &&
    !name.startsWith('.')
  )
}

export function noteCreationPath(
  parent: string,
  value: string,
  folder: boolean
): string {
  if (!validNoteEntryName(value)) throw new Error('Invalid entry name')
  const name = value.trim()
  const filename = folder || /\.md$/i.test(name) ? name : name + '.md'
  return [parent, filename].filter(Boolean).join('/')
}
