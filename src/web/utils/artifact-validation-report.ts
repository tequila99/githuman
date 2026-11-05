import { artifactActionsApi } from '@/api/artifact-actions'
import type { ArtifactReportChunk, ArtifactValidationView } from '@/api/types'
import { isRecord } from '@/utils/guards'

// Bound JSON allocation without silently dropping any findings.
const MAX_REPORT_BYTES = 16 * 1024 * 1024

type ChunkLoader = (offset: number) => Promise<ArtifactReportChunk>

/** Reads all chunks of one report part and checks identity, size and continuation. */
async function readChunks(id: string, load: ChunkLoader): Promise<string> {
  let offset = 0
  let total: number | null = null
  const chunks: string[] = []
  do {
    const chunk = await load(offset)
    const bytes = new TextEncoder().encode(chunk.text).length
    total ??= chunk.totalBytes
    if (
      chunk.id !== id ||
      chunk.offset !== offset ||
      chunk.totalBytes !== total ||
      total > MAX_REPORT_BYTES ||
      total < 0 ||
      bytes + offset > total
    ) {
      throw new Error(
        'The validation report chunk does not match its identity or size.'
      )
    }
    chunks.push(chunk.text)
    if (chunk.nextOffset === null) {
      if (offset + bytes !== total) {
        throw new Error('Incomplete validation report.')
      }
      break
    }
    if (
      chunk.nextOffset !== offset + bytes ||
      chunk.nextOffset <= offset ||
      chunk.nextOffset >= total
    ) {
      throw new Error('Invalid validation report continuation.')
    }
    offset = chunk.nextOffset
  } while (offset < total)
  return chunks.join('')
}

function assertFinished(validation: ArtifactValidationView) {
  if (validation.state === 'running' || validation.state === 'prepared') {
    throw new Error(
      'Wait for the validation to finish before reading its report.'
    )
  }
}

/** Markdown report text of a validation (ADR 0122); null when the validator attached none. */
export async function readArtifactValidationReportText(
  validation: ArtifactValidationView,
  signal?: AbortSignal
): Promise<string | null> {
  assertFinished(validation)
  if (!validation.report?.text) {
    return null
  }
  const text = await readChunks(validation.id, offset =>
    artifactActionsApi.reportText(validation.id, offset, signal)
  )
  if (new TextEncoder().encode(text).length !== validation.report.text.bytes) {
    throw new Error('The report text does not match its validation.')
  }
  return text
}

export async function readArtifactValidationReport(
  validation: ArtifactValidationView,
  signal?: AbortSignal
) {
  assertFinished(validation)
  const raw = await readChunks(validation.id, offset =>
    artifactActionsApi.report(validation.id, offset, signal)
  )
  const value: unknown = JSON.parse(raw)
  if (value === null && validation.report === null) return null
  if (
    !isRecord(value) ||
    (value.verdict !== 'pass' &&
      value.verdict !== 'conflict' &&
      value.verdict !== 'incomplete') ||
    value.verdict !== validation.report?.verdict ||
    value.manifestDigest !== validation.manifestDigest ||
    value.changeDigest !== validation.changeDigest ||
    value.validatorSessionId !== validation.validatorSessionId ||
    !Array.isArray(value.findings) ||
    !Array.isArray(value.resolutions)
  ) {
    throw new Error('The report does not match its validation.')
  }
  const findings = value.findings.map((finding: unknown) => {
    if (
      !isRecord(finding) ||
      typeof finding.artifactId !== 'string' ||
      typeof finding.quote !== 'string' ||
      typeof finding.message !== 'string'
    ) {
      throw new Error('Invalid validation finding.')
    }
    return {
      artifactId: finding.artifactId,
      quote: finding.quote,
      message: finding.message
    }
  })
  const resolutions = value.resolutions.filter(
    (item: unknown): item is string => typeof item === 'string'
  )
  if (
    resolutions.length !== value.resolutions.length ||
    findings.length !== validation.report?.findingCount
  ) {
    throw new Error('Incomplete structured report.')
  }
  return { verdict: value.verdict, findings, resolutions }
}
