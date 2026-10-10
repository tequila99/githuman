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
  missing: 'file' | 'message' | 'attachment' | 'diagram' | null
  loaded: boolean
  stale: boolean
}
