import { createFileDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

const [root, path] = process.argv.slice(2)
const db = createFileDatabase(path)
const service = new ArtifactStorageService({
  db,
  repositoryPath: root,
  prefix: 'ght-'
})
process.send!({ ready: true })
process.once(
  'message',
  (message: { action: string; requestId: string; id?: string }) => {
    try {
      const actor = { kind: 'agent' as const, id: 'worker' }
      const metadata = { title: message.requestId, tags: [] }
      const artifact =
        message.action === 'create'
          ? service.create(
              { requestId: message.requestId, body: '# Concurrent', metadata },
              actor
            )
          : service.updateMetadata(
              message.id!,
              { requestId: message.requestId, expectedVersion: 1, metadata },
              actor
            )
      process.send!({ artifact })
    } catch (error) {
      process.send!({
        error:
          error instanceof Error && 'code' in error ? error.code : 'UNKNOWN'
      })
    } finally {
      db.close()
      process.disconnect()
    }
  }
)
