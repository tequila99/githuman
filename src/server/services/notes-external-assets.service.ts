import PQueue from 'p-queue'
import { BadRequestError } from '../errors/http.ts'
import {
  NoteAssetLimitError,
  NoteAssetQueueError
} from '../errors/note-assets.ts'
import {
  destroyRemoteAssetResponse,
  remoteAssetRequest,
  translateRemoteAssetError,
  type RemoteAssetRequest,
  type RemoteAssetResponse
} from '../utils/remote-asset-request.ts'
import { detectNoteAssetFormat } from '../utils/note-asset-format.ts'
import {
  MAX_NOTE_ASSET_BYTES,
  NOTE_PDF_WARNING_BYTES
} from '../../shared/notes/constants.ts'
import { maxNoteAssetBytes } from '../../shared/notes/asset-formats.ts'
import type {
  ImportExternalAsset,
  ExternalAssetResult
} from '../../shared/notes/types.ts'

// Limit disk and memory pressure across imports and background previews.
const ACTIVE_LIMIT = 3
const QUEUE_LIMIT = 30
// Bound active operations so stalled imports cannot occupy queue slots indefinitely.
const OPERATION_TIMEOUT_MS = 120000
// A small prefix is sufficient for supported image and PDF signatures.
const FORMAT_PREFIX_BYTES = 8192
// Explain the preview limit to the client in megabytes.
const PREVIEW_LIMIT_MESSAGE = `Image exceeds ${MAX_NOTE_ASSET_BYTES / 1_000_000} MB`

// Counts bytes read from a response so callers can report the size at the limit.
interface ByteCounter {
  bytes: number
}

// Yields Buffer chunks and fails once the total passes the limit.
async function* boundedChunks(
  source: AsyncIterable<Uint8Array>,
  limit: number,
  counter: ByteCounter,
  signal: AbortSignal,
  message: string
): AsyncGenerator<Buffer> {
  for await (const value of source) {
    signal.throwIfAborted()
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    counter.bytes += chunk.length
    if (counter.bytes > limit) throw new NoteAssetLimitError(message)
    yield chunk
  }
}

function isSuccess(response: RemoteAssetResponse) {
  return (
    response.statusCode !== undefined &&
    response.statusCode >= 200 &&
    response.statusCode < 300
  )
}

export class NotesExternalAssetsService {
  private readonly queue = new PQueue({ concurrency: ACTIVE_LIMIT })
  private readonly request: RemoteAssetRequest
  constructor(request: RemoteAssetRequest = remoteAssetRequest) {
    this.request = request
  }

  private run<T>(
    signal: AbortSignal,
    priority: boolean,
    work: (signal: AbortSignal) => Promise<T>
  ) {
    signal.throwIfAborted()
    if (this.queue.pending >= ACTIVE_LIMIT && this.queue.size >= QUEUE_LIMIT) {
      throw new NoteAssetQueueError()
    }
    // The queue removes a task that waits when its signal aborts. A running
    // task stops through the signal that it receives.
    return this.queue.add(
      async () => {
        try {
          return await work(
            AbortSignal.any([signal, AbortSignal.timeout(OPERATION_TIMEOUT_MS)])
          )
        } catch (error) {
          throw translateRemoteAssetError(error)
        }
      },
      { priority: priority ? 1 : 0, signal }
    )
  }

  async inspect(url: string, signal: AbortSignal) {
    return this.run(signal, false, async abort => {
      const response = await this.request(url, 'HEAD', abort)
      try {
        return {
          size: isSuccess(response) ? this.length(response) : null
        }
      } finally {
        destroyRemoteAssetResponse(response)
      }
    })
  }
  private length(response: RemoteAssetResponse) {
    const value = response.headers['content-length']
    if (!value || !/^\d+$/.test(value)) return null
    const size = Number(value)
    return Number.isSafeInteger(size) ? size : null
  }

  async importAsset(
    input: ImportExternalAsset,
    signal: AbortSignal,
    save: (
      chunks: AsyncIterable<Buffer>,
      extension: string,
      signal: AbortSignal
    ) => Promise<string>
  ): Promise<ExternalAssetResult> {
    return this.run(signal, true, async abort => {
      const response = await this.request(input.url, 'GET', abort)
      try {
        this.checkResponse(response)
        const fileLimit = maxNoteAssetBytes(input.kind)
        const warningLimit =
          input.kind === 'pdf' && !input.allowLargePdf
            ? NOTE_PDF_WARNING_BYTES
            : fileLimit
        const limit = Math.min(input.remainingBytes, fileLimit, warningLimit)
        const over = (size: number): ExternalAssetResult | undefined => {
          if (size <= limit) return undefined
          if (size > input.remainingBytes) {
            return { status: 'rejected', reason: 'operation-limit' }
          }
          if (size > fileLimit) {
            return { status: 'rejected', reason: 'file-too-large' }
          }
          return {
            status: 'confirmation-required',
            size: this.length(response)
          }
        }
        const known = this.length(response)
        if (known !== null) {
          const result = over(known)
          if (result) return result
        }
        const counter: ByteCounter = { bytes: 0 }
        const iterator = boundedChunks(
          response,
          limit,
          counter,
          abort,
          'Attachment download limit reached'
        )
        const prefix: Buffer[] = []
        let prefixBytes = 0
        try {
          while (prefixBytes < FORMAT_PREFIX_BYTES) {
            const next = await iterator.next()
            if (next.done) break
            prefix.push(next.value)
            prefixBytes += next.value.length
          }
          const format = await detectNoteAssetFormat(Buffer.concat(prefix))
          if ((format.display === 'link' ? 'pdf' : 'image') !== input.kind) {
            throw new BadRequestError(
              'Attachment type does not match the selected resource'
            )
          }
          const body = async function* () {
            yield* prefix
            yield* iterator
          }
          const url = await save(body(), format.extension, abort)
          return {
            status: 'stored',
            url,
            bytes: counter.bytes,
            format: format.extension
          } as const
        } catch (error) {
          if (error instanceof NoteAssetLimitError) return over(counter.bytes)!
          throw error
        }
      } finally {
        destroyRemoteAssetResponse(response)
      }
    })
  }
  async preview(url: string, signal: AbortSignal) {
    return this.run(signal, false, async abort => {
      const response = await this.request(url, 'GET', abort)
      try {
        this.checkResponse(response)
        if ((this.length(response) ?? 0) > MAX_NOTE_ASSET_BYTES) {
          throw new NoteAssetLimitError(PREVIEW_LIMIT_MESSAGE)
        }
        const chunks: Buffer[] = []
        for await (const chunk of boundedChunks(
          response,
          MAX_NOTE_ASSET_BYTES,
          { bytes: 0 },
          abort,
          PREVIEW_LIMIT_MESSAGE
        )) {
          chunks.push(chunk)
        }
        const body = Buffer.concat(chunks)
        const format = await detectNoteAssetFormat(body)
        if (format.display !== 'image') {
          throw new BadRequestError('Preview is not an image')
        }
        return { body, mime: format.mime }
      } finally {
        destroyRemoteAssetResponse(response)
      }
    })
  }
  private checkResponse(response: RemoteAssetResponse) {
    if (!isSuccess(response)) {
      throw new BadRequestError(
        'Attachment server returned HTTP ' + response.statusCode
      )
    }
    if (
      response.headers['content-encoding'] &&
      response.headers['content-encoding'] !== 'identity'
    ) {
      throw new BadRequestError(
        'Compressed attachment responses are not supported'
      )
    }
  }
}
