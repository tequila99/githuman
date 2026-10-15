// Bound image uploads in both the browser and the multipart parser.
export const MAX_NOTE_ASSET_BYTES = 10_000_000

// PDF imports require confirmation above the smaller threshold.
export const NOTE_PDF_WARNING_BYTES = 50_000_000
export const MAX_NOTE_PDF_BYTES = 100_000_000
// This bounds useful downloads in one client operation.
export const MAX_NOTE_IMPORT_BYTES = 200_000_000
