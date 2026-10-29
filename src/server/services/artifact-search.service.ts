import {
  MAX_SEARCH_QUERY_CODEPOINTS,
  MAX_SEARCH_TOKENS,
  MAX_SEARCH_VARIANTS,
  MAX_SEARCH_WORD_CODEPOINTS
} from '../../shared/artifacts/constants.ts'
import type { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { Value } from '@sinclair/typebox/value'
import { ArtifactSearchBody } from '../../shared/artifacts/schemas.ts'
import type {
  Artifact,
  ArtifactSearchInput,
  ArtifactSearchItem,
  ArtifactSearchResult
} from '../../shared/artifacts/types.ts'
import {
  normalizeSearch,
  searchTokens,
  searchMatchExpression,
  searchEditLimit,
  boundedSearchDistance,
  originalSearchRange,
  type SearchOffset
} from '../../shared/artifacts/search.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { sha256Hex } from '../utils/hash.ts'
import { artifactBody } from '../utils/artifact-body.ts'
import { takeWithinBytes } from '../utils/take-within-bytes.ts'
import { ArtifactSearchRepository } from '../repositories/artifact-search.repo.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactIntegrityError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'

// Bound fuzzy work independently of corpus size; return an explicit partial flag.
const FUZZY_CANDIDATES = 2048
// Leave time for SQL, integrity checks and snippets below the one-second target.
const FUZZY_BUDGET_MS = 150
// Keep plain-text excerpts useful without returning whole files.
const SNIPPET_CHARS = 640
// Escaping control characters must not turn one anchor into an oversized MCP page.
const SEARCH_ANCHOR_BYTES = 8192

function isValidVariants(
  value: unknown,
  tokens: readonly string[],
  mode: ArtifactSearchInput['mode']
): value is string[][] {
  if (!Array.isArray(value)) return false
  if (mode === 'exact') return value.length === 0
  return (
    value.length === tokens.length &&
    value.every((group, index) => {
      if (
        !Array.isArray(group) ||
        !group.length ||
        group.length > MAX_SEARCH_VARIANTS ||
        group[0] !== tokens[index] ||
        new Set(group).size !== group.length
      ) {
        return false
      }
      const token = tokens[index] ?? '',
        length = Array.from(token).length
      return group.every(
        (term, variant) =>
          typeof term === 'string' &&
          (variant === 0 ||
            (term.length > 0 &&
              Array.from(term).length <= MAX_SEARCH_WORD_CODEPOINTS &&
              /^[\p{L}\p{N}\p{M}]+$/u.test(term) &&
              Math.abs(Array.from(term).length - length) <=
                searchEditLimit(token)))
      )
    })
  )
}

export class ArtifactSearchService {
  readonly repository: ArtifactSearchRepository
  private readonly storage: ArtifactStorageService
  constructor(storage: ArtifactStorageService, db: DatabaseSync) {
    this.storage = storage
    this.repository = new ArtifactSearchRepository(db, storage.storeId)
  }
  index(artifact: Artifact): void {
    try {
      this.repository.index(artifact, () =>
        artifactBody(
          this.storage.readVerifiedFile(artifact.id).content.toString('utf8'),
          artifact.bodyStartLine
        )
      )
    } catch (error) {
      if (
        !(error instanceof ArtifactIntegrityError) &&
        !(error instanceof ArtifactNotFoundError)
      ) {
        throw error
      }
      this.repository.suppress(
        artifact.id,
        'Artifact content is missing or failed integrity verification.'
      )
    }
  }
  rebuild() {
    this.repository.assertAvailable()
    return this.storage.catalog.transaction(() => {
      this.repository.reset()
      for (const artifact of this.storage.catalog.all()) this.index(artifact)
      return this.repository.diagnostics()
    })
  }
  diagnostics() {
    return this.repository.diagnostics()
  }
  search(input: ArtifactSearchInput = {}): ArtifactSearchResult {
    if (!Value.Check(ArtifactSearchBody, input)) {
      throw new ArtifactInputError('Invalid artifact search parameters.')
    }
    const query = input.query?.trim() ?? '',
      normalized = normalizeSearch(query),
      tokens = searchTokens(query, false)
    if (
      Array.from(query).length > MAX_SEARCH_QUERY_CODEPOINTS ||
      tokens.length > MAX_SEARCH_TOKENS
    ) {
      throw new ArtifactInputError(
        `Search accepts at most ${MAX_SEARCH_QUERY_CODEPOINTS} characters and ${MAX_SEARCH_TOKENS} tokens.`
      )
    }
    if (query.includes('\u0000')) {
      throw new ArtifactInputError('Search query must not contain NUL.')
    }
    this.repository.assertAvailable()
    const result = this.storage.catalog.transaction(() => {
      for (const id of this.repository.pending()) {
        this.index(this.storage.get(id))
      }
      const epoch = this.storage.catalog.epoch(),
        indexEpoch = this.repository.epoch()
      const queryDigest = sha256Hex(
        canonicalJson({
          query,
          mode: input.mode ?? 'auto',
          filters: input.filters ?? {},
          sort: input.sort ?? (query ? 'relevance' : 'createdAt')
        })
      )
      let offset = 0,
        variants: string[][] = [],
        partial = false
      if (input.cursor) {
        let cursor: unknown
        try {
          cursor = JSON.parse(
            Buffer.from(input.cursor, 'base64url').toString('utf8')
          )
        } catch {
          throw new ArtifactInputError('Invalid search cursor.')
        }
        if (
          !cursor ||
          typeof cursor !== 'object' ||
          !('storeId' in cursor) ||
          cursor.storeId !== this.storage.storeId ||
          !('queryDigest' in cursor) ||
          cursor.queryDigest !== queryDigest ||
          !('offset' in cursor) ||
          !Number.isSafeInteger(cursor.offset) ||
          Number(cursor.offset) < 0
        ) {
          throw new ArtifactInputError(
            'Search cursor does not match the query.'
          )
        }
        if (
          !('epoch' in cursor) ||
          cursor.epoch !== epoch ||
          !('indexEpoch' in cursor) ||
          cursor.indexEpoch !== indexEpoch
        ) {
          throw new ArtifactConflictError('Search changed. Restart pagination.')
        }
        if (
          !('variants' in cursor) ||
          !isValidVariants(cursor.variants, tokens, input.mode) ||
          !('partial' in cursor) ||
          typeof cursor.partial !== 'boolean'
        ) {
          throw new ArtifactInputError('Invalid fuzzy search cursor.')
        }
        variants = cursor.variants
        partial = cursor.partial
        offset = Number(cursor.offset)
      }
      const started = performance.now()
      if (!input.cursor && input.mode !== 'exact') {
        for (const token of tokens) {
          const limit = searchEditLimit(token),
            matches: { token: string; distance: number; frequency: number }[] =
              []
          if (limit) {
            const candidates = this.repository.candidates(
              token,
              limit,
              FUZZY_CANDIDATES + 1
            )
            if (candidates.length > FUZZY_CANDIDATES) partial = true
            for (const candidate of candidates.slice(0, FUZZY_CANDIDATES)) {
              if (performance.now() - started > FUZZY_BUDGET_MS) {
                partial = true
                break
              }
              const distance = boundedSearchDistance(
                token,
                candidate.token,
                limit
              )
              if (distance <= limit) matches.push({ ...candidate, distance })
            }
          }
          matches.sort(
            (a, b) =>
              a.distance - b.distance ||
              b.frequency - a.frequency ||
              a.token.localeCompare(b.token)
          )
          variants.push(
            [...new Set([token, ...matches.map(item => item.token)])].slice(
              0,
              MAX_SEARCH_VARIANTS
            )
          )
        }
      }
      const exactExpression = searchMatchExpression(
        tokens.map(token => [token])
      )
      const fuzzyExpression = variants.some((group, i) =>
        group.some(token => token !== tokens[i])
      )
        ? searchMatchExpression(variants)
        : ''
      const limit = input.limit ?? 50
      const options = {
        ...input,
        sort:
          input.sort ??
          (query ? ('relevance' as const) : ('createdAt' as const))
      }
      const collect = (pageOffset: number) => {
        const rows = this.repository.select(
          options,
          normalized,
          exactExpression,
          fuzzyExpression,
          pageOffset,
          limit + 1
        )
        const items: ArtifactSearchItem[] = []
        let more = false,
          suppressed = false
        for (const row of rows) {
          if (items.length >= limit) {
            more = true
            break
          }
          const artifact = this.storage.get(row.id)
          try {
            const body = artifactBody(
              this.storage.readVerifiedFile(row.id).content.toString('utf8'),
              artifact.bodyStartLine
            )
            const item = this.snippet(
              artifact,
              body,
              query,
              normalized,
              [...new Set([...tokens, ...variants.flat()])],
              row.tier
            )
            if (
              takeWithinBytes([...items, item], limit).length <= items.length
            ) {
              more = true
              break
            }
            items.push(item)
          } catch (error) {
            if (
              !(error instanceof ArtifactIntegrityError) &&
              !(error instanceof ArtifactNotFoundError)
            ) {
              throw error
            }
            this.repository.suppress(
              row.id,
              'Artifact content is missing or failed integrity verification.'
            )
            suppressed = true
          }
        }
        return { items, more, suppressed }
      }
      let page = collect(offset)
      while (page.suppressed) {
        // Commit suppression before asking a cursor client to restart its changed ranking.
        if (input.cursor) return { restart: true as const }
        page = collect(0)
      }
      const { items, more } = page
      offset += items.length
      return {
        storeId: this.storage.storeId,
        storeEpoch: epoch,
        indexEpoch: this.repository.epoch(),
        items,
        nextCursor: more
          ? Buffer.from(
              JSON.stringify({
                storeId: this.storage.storeId,
                epoch,
                indexEpoch: this.repository.epoch(),
                queryDigest,
                variants,
                partial,
                offset
              })
            ).toString('base64url')
          : null,
        partial,
        reason: partial
          ? 'Fuzzy candidate or time budget reached; exact results are retained.'
          : null
      }
    })
    if ('restart' in result) {
      throw new ArtifactConflictError('Search changed. Restart pagination.')
    }
    return result
  }
  private snippet(
    artifact: Artifact,
    body: string,
    query: string,
    normalized: string,
    terms: string[],
    tier: number
  ): ArtifactSearchItem {
    const indexed = this.repository.document(artifact.id)!
    let source: 'title' | 'body' = 'body',
      start = -1,
      length = normalized.length
    if (normalized) {
      start = indexed.title.indexOf(normalized)
      if (start >= 0) {
        source = 'title'
      } else {
        start = indexed.body.indexOf(normalized)
      }
      if (start < 0) {
        for (const term of terms) {
          const titleAt = indexed.title.indexOf(term),
            bodyAt = indexed.body.indexOf(term)
          if (titleAt >= 0) {
            source = 'title'
            start = titleAt
            length = term.length
            break
          }
          if (bodyAt >= 0) {
            start = bodyAt
            length = term.length
            break
          }
        }
      }
    }
    const original = source === 'title' ? artifact.title : body
    const offsets: SearchOffset[] = JSON.parse(
      source === 'title' ? indexed.title_offsets : indexed.body_offsets
    )
    const [from, to] = originalSearchRange(
      Math.max(0, start),
      Math.max(0, start) + (start >= 0 ? length : 0),
      offsets
    )
    let excerptFrom = Math.max(0, from - 80),
      excerptTo = Math.min(original.length, excerptFrom + SNIPPET_CHARS)
    if (excerptFrom && /[\uDC00-\uDFFF]/.test(original[excerptFrom])) {
      excerptFrom++
    }
    if (
      excerptTo < original.length &&
      /[\uDC00-\uDFFF]/.test(original[excerptTo])
    ) {
      excerptTo--
    }
    const snippet = original.slice(excerptFrom, excerptTo)
    let anchor: ArtifactSearchItem['anchor'] = null
    if (source === 'body' && start >= 0) {
      const lineFrom = original.lastIndexOf('\n', Math.max(0, from - 1)) + 1
      const newline = original.indexOf('\n', Math.max(from, to - 1)),
        lineTo = newline < 0 ? original.length : newline + 1
      const quote = original.slice(lineFrom, lineTo)
      if (Buffer.byteLength(quote) <= SEARCH_ANCHOR_BYTES) {
        anchor = {
          artifactId: artifact.id,
          fileSha256: artifact.sha256,
          bodyStartLine: artifact.bodyStartLine,
          startLine: original.slice(0, lineFrom).split('\n').length,
          endLine: original.slice(0, Math.max(lineFrom, lineTo - 1)).split('\n')
            .length,
          quote
        }
      }
    }
    return {
      storeId: artifact.storeId,
      id: artifact.id,
      title: artifact.title,
      status: artifact.status,
      typeId: artifact.typeId,
      taskIds: artifact.taskIds,
      snippet,
      source,
      matchKind: !query
        ? 'catalog'
        : tier === 2
          ? 'fuzzy'
          : tier === 1
            ? 'token'
            : original.slice(from, to) === query
              ? 'exact'
              : 'exact_normalized',
      highlights:
        start >= 0
          ? [
              {
                start: from - excerptFrom,
                end: Math.min(to, excerptTo) - excerptFrom
              }
            ]
          : [],
      anchor
    }
  }
}
