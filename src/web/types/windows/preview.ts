export type PreviewSource =
  | { type: 'file'; path: string; ref: string }
  | { type: 'local'; id: string }
  | { type: 'message'; sessionId: string; messageId: string }
export interface PreviewTab {
  id: string
  kind: 'markdown' | 'diagram' | 'image' | 'pdf'
  source: PreviewSource
  title: string
  index: number
  fingerprint: string
  scroll: { x: number; y: number }
  scale: number
}
export interface PreviewData {
  text: string
  image: string
  pdf: File | null
  loading: boolean
  error: string | null
  missing: 'file' | 'message' | 'attachment' | 'diagram' | 'binary' | null
  loaded: boolean
  stale: boolean
}

export interface PreviewOpenOptions {
  title: string
  /** Position of the diagram or attachment inside its source. */
  index?: number
  /** Content that identifies a diagram or an image inside its source. */
  content?: string
  /** Full source text; lets an edited diagram keep its tab. */
  sourceText?: string
}
