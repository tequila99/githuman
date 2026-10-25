/** True for a path that names a PDF file. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}
