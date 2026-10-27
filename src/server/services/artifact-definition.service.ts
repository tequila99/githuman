import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import { ArtifactActorSchema } from '../../shared/artifacts/schemas.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'
import { TaskRepository, type Definition } from '../repositories/task.repo.ts'
import type { ArtifactCatalogRepository } from '../repositories/artifact-catalog.repo.ts'
import { sha256Hex } from '../utils/hash.ts'
import { artifactPage } from '../utils/artifact-page.ts'

export interface DefinitionServiceOptions {
  repository: TaskRepository
  catalog: ArtifactCatalogRepository
  onChange: () => void
  now?: () => number
}

export function assertDefinitionInput(schema: TSchema, value: unknown): void {
  if (!Value.Check(schema, value)) {
    throw new ArtifactInputError('Invalid definition input.')
  }
}

export class ArtifactDefinitionService<T extends Definition> {
  protected readonly options: DefinitionServiceOptions
  private readonly kind: 'task' | 'artifact_type'
  constructor(
    options: DefinitionServiceOptions,
    kind: 'task' | 'artifact_type'
  ) {
    this.options = options
    this.kind = kind
  }
  get(id: string): T {
    const result = this.options.repository.get<T>(this.kind, id)
    if (!result) throw new ArtifactNotFoundError()
    return result
  }
  list(limit = 50, cursor?: string) {
    return this.options.catalog.readSnapshot(() =>
      artifactPage(this.options.repository.all<T>(this.kind), {
        storeId: this.options.catalog.storeId,
        epoch: this.options.catalog.epoch(),
        query: this.kind,
        limit,
        cursor
      })
    )
  }
  history(id: string) {
    this.get(id)
    return this.options.repository.history<T>(this.kind, id)
  }
  historyPage(id: string, limit = 50, cursor?: string) {
    return this.options.catalog.readSnapshot(() =>
      artifactPage(this.history(id), {
        storeId: this.options.catalog.storeId,
        epoch: this.options.catalog.epoch(),
        query: `${this.kind}:history:${id}`,
        limit,
        cursor
      })
    )
  }
  protected mutate(
    requestId: string,
    payload: unknown,
    actor: ArtifactActor,
    run: () => T
  ): T {
    return this.command(requestId, payload, actor, () => {
      const result = run()
      this.options.repository.append(
        this.kind,
        result,
        requestId,
        actor,
        new Date((this.options.now ?? Date.now)()).toISOString()
      )
      this.options.catalog.recordChange(this.kind, result.id, requestId)
      return result
    })
  }
  protected command<R>(
    requestId: string,
    payload: unknown,
    actor: ArtifactActor,
    run: () => R
  ): R {
    if (
      typeof requestId !== 'string' ||
      !requestId.length ||
      requestId.length > 128
    ) {
      throw new ArtifactInputError('Invalid request identifier.')
    }
    assertDefinitionInput(ArtifactActorSchema, actor)
    const hash = sha256Hex(canonicalJson({ kind: this.kind, payload, actor }))
    const { result } = this.options.catalog.transaction(() => {
      const replay = this.options.repository.replay<R>(requestId, hash)
      if (replay) return { result: replay.result }
      const created = run()
      this.options.repository.record(requestId, hash, created)
      return { result: created }
    })
    this.options.onChange()
    return result
  }
  protected assertVersion(actual: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1) {
      throw new ArtifactInputError('Invalid expected version.')
    }
    if (actual !== expected) {
      throw new ArtifactConflictError('Definition version changed.')
    }
  }
}
