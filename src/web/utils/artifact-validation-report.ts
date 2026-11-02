import { artifactActionsApi } from '@/api/artifact-actions'
import type { ArtifactValidationView } from '@/api/types'
import { isRecord } from '@/utils/guards'

// Bound JSON allocation without silently dropping any findings.
const MAX_REPORT_BYTES = 16 * 1024 * 1024

export async function readArtifactValidationReport(
  validation: ArtifactValidationView,
  signal?: AbortSignal
) {
  if (validation.state === 'running' || validation.state === 'prepared') {
    throw new Error(
      'Wait for the validation to finish before reading its report.'
    )
  }
  let offset = 0
  let total: number | null = null
  const chunks: string[] = []
  do {
    const chunk = await artifactActionsApi.report(validation.id, offset, signal)
    const bytes = new TextEncoder().encode(chunk.text).length
    total ??= chunk.totalBytes
    if (
      chunk.id !== validation.id ||
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
  const value: unknown = JSON.parse(chunks.join(''))
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
