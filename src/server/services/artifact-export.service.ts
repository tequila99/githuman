import { Readable } from 'node:stream'
import type { ArtifactStorageService } from './artifact-storage.service.ts'
import type { ArtifactMetadataExport } from '../../shared/artifacts/types.ts'

// Bound allocation independently of the total number of metadata versions.
const HISTORY_PAGE_SIZE = 50

export class ArtifactExportService {
  private readonly storage: ArtifactStorageService
  constructor(storage: ArtifactStorageService) {
    this.storage = storage
  }
  original(id: string) {
    return this.storage.catalog.readSnapshot(() =>
      this.storage.readVerifiedFile(id)
    )
  }
  metadataHistory(id: string) {
    const storage = this.storage
    const snapshot: Omit<ArtifactMetadataExport, 'history'> =
      storage.catalog.readSnapshot(() => {
        const snapshotSeq = storage.catalog.eventSequence()
        storage.catalog.assertExportHistory(id, snapshotSeq)
        return {
          formatVersion: 1,
          storeId: storage.storeId,
          artifactId: id,
          snapshotSeq,
          storeEpoch: storage.catalog.epoch(),
          artifact: storage.get(id)
        }
      })
    async function* chunks() {
      yield JSON.stringify(snapshot).slice(0, -1) + ',"history":['
      let afterSeq = 0
      let first = true
      for (;;) {
        const page = storage.catalog.exportHistory(
          id,
          afterSeq,
          snapshot.snapshotSeq,
          HISTORY_PAGE_SIZE
        )
        if (!page.length) break
        for (const event of page) {
          yield (first ? '' : ',') + JSON.stringify(event)
          first = false
          afterSeq = event.seq
        }
      }
      yield ']}'
    }
    return Readable.from(chunks(), { objectMode: false })
  }
}
