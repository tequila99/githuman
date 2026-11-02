import { isValidArtifactTypeId } from '../../shared/utils/is-valid-artifact-type-id.ts'
import { sha256Hex } from '../utils/hash.ts'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import type {
  ArtifactType,
  ArtifactTypeInput
} from '../../shared/tasks/types.ts'
import { ArtifactTypeInputSchema } from '../../shared/tasks/schemas.ts'
import {
  ArtifactConflictError,
  ArtifactInputError
} from '../errors/artifacts.ts'
import {
  ArtifactDefinitionService,
  assertDefinitionInput,
  type DefinitionServiceOptions
} from './artifact-definition.service.ts'

// Built-in identifiers stay usable by old documents and are seeded once per store.
const INITIAL_TYPES = [
  'generic',
  'plan',
  'review',
  'research',
  'prd',
  'adr',
  'proposal',
  'specification',
  'report'
] as const

// New documents use this type unless the caller names another one.
const DEFAULT_TYPE_ID = 'generic'

export class ArtifactTypeService extends ArtifactDefinitionService<ArtifactType> {
  constructor(options: DefinitionServiceOptions) {
    super(options, 'artifact_type')
    options.catalog.transaction(() => {
      for (const id of INITIAL_TYPES) {
        if (options.repository.get('artifact_type', id)) continue
        if (options.repository.history('artifact_type', id).length) {
          options.repository.rebuild()
          continue
        }
        const snapshot: ArtifactType = {
          storeId: options.catalog.storeId,
          id,
          label: id,
          active: true,
          version: 1
        }
        options.repository.append(
          'artifact_type',
          snapshot,
          `seed:type:${id}`,
          { kind: 'system', id: 'artifact-types' },
          new Date((options.now ?? Date.now)()).toISOString()
        )
        options.repository.record(
          `seed:type:${id}`,
          sha256Hex(`seed:type:${id}`),
          snapshot
        )
      }
    })
  }
  create(
    requestId: string,
    id: string,
    input: ArtifactTypeInput,
    actor: ArtifactActor
  ): ArtifactType {
    this.validate(id, input)
    return this.mutate(
      requestId,
      { command: 'create', id, input },
      actor,
      () => {
        if (this.options.repository.get('artifact_type', id)) {
          throw new ArtifactConflictError('Artifact type already exists.')
        }
        return {
          storeId: this.options.catalog.storeId,
          id,
          ...input,
          version: 1
        }
      }
    )
  }
  update(
    id: string,
    requestId: string,
    expectedVersion: number,
    input: ArtifactTypeInput,
    actor: ArtifactActor
  ): ArtifactType {
    this.validate(id, input)
    if (id === DEFAULT_TYPE_ID && !input.active) {
      throw new ArtifactInputError(
        'The default artifact type cannot be deactivated.'
      )
    }
    return this.mutate(
      requestId,
      { command: 'update', id, expectedVersion, input },
      actor,
      () => {
        const previous = this.get(id)
        this.assertVersion(previous.version, expectedVersion)
        return { ...previous, ...input, version: previous.version + 1 }
      }
    )
  }
  private validate(id: string, input: ArtifactTypeInput): void {
    assertDefinitionInput(ArtifactTypeInputSchema, input)
    if (!isValidArtifactTypeId(id) || !input.label.trim()) {
      throw new ArtifactInputError('Invalid artifact type.')
    }
  }
}
