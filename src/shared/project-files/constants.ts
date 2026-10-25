// Preview buffers must remain bounded independently of download sizes.
export const PROJECT_TEXT_LIMIT = 2_000_000
// Match the existing image preview budget.
export const PROJECT_IMAGE_LIMIT = 10_000_000
// Match the existing PDF preview budget.
export const PROJECT_PDF_LIMIT = 100_000_000
// A download is buffered in memory by the browser, so it has an upper bound.
export const PROJECT_DOWNLOAD_LIMIT = 100_000_000
// The longest repository-relative path that the API accepts.
export const MAX_PROJECT_PATH_LENGTH = 4096
// The app route that opens a project file. Markdown links point to it.
export const PROJECT_FILE_ROUTE = '/files/open'
// The query that marks a link that cannot open. The link renders as an error.
export const PROJECT_FILE_INVALID_QUERY = 'invalid=true'
// A file: link. The default Markdown link validation rejects it.
export const FILE_URI_PATTERN = /^file:\/\//i
// MIME type of a file that has no preview. A download uses it for every file.
export const PROJECT_DOWNLOAD_MIME = 'application/octet-stream'
