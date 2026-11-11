// Seeds an archive proposal and a completed transition in a throwaway repository.
// The e2e tests never touch this project's own store.
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileDatabase } from '../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../src/server/services/artifact-storage.service.ts'
import type { AgentSessionRegistry } from '../../src/server/services/agent/session-registry.ts'

// Port of the Playwright web server; it must match `playwright.config.ts`.
const PORT = '4390'
// The tests read the seeded IDs from this file.
export const FIXTURE_PATH = join(tmpdir(), 'githuman-e2e-fixture.json')
const USER = { kind: 'user' as const, id: 'local' }
const TITLES = ['Alpha', 'Beta']
// The reason has a colon in front of it in the dialog: the tests check the gap.
const REASON = 'E2E: archive two documents'

const root = mkdtempSync(join(tmpdir(), 'githuman-e2e-'))
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
git('init', '-q', '-b', 'develop')
git('config', 'user.email', 'e2e@example.com')
git('config', 'user.name', 'e2e')
writeFileSync(join(root, 'a.txt'), 'a\n')
git('add', '.')
git('commit', '-qm', 'init')

function seed() {
  const db = createFileDatabase(join(root, '.githuman/ght-reviews.db'))
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  // A validator session without an agent process: the seed submits its report itself.
  const sessions = new Map<string, unknown>()
  storage.lifecycle.attachSessions({
    listPresets: () => [{ id: 'e2e', available: true }],
    create() {
      const value = {
        id: randomUUID(),
        status: 'ready',
        onEvent: () => () => {},
        prompt: () => {}
      }
      sessions.set(value.id, value)
      return value
    },
    get: (id: string) => sessions.get(id),
    close: () => true,
    trackArtifactRequest: () => () => {},
    notifyArtifactActionsChanged() {}
  } as unknown as AgentSessionRegistry)
  const docs = TITLES.map(title => {
    const created = storage.create(
      {
        requestId: randomUUID(),
        body: `# ${title}\n\nBody of ${title}.\n`,
        metadata: { title, tags: [], relations: [] },
        revisionOf: []
      },
      USER
    )
    const next = {
      ...created,
      status: 'in_review' as const,
      metadataVersion: 2
    }
    storage.catalog.transaction(() =>
      storage.catalog.appendMetadata(
        next,
        randomUUID(),
        USER,
        'metadata_updated'
      )
    )
    return next
  })
  const proposal = storage.lifecycle.propose(
    {
      requestId: randomUUID(),
      changeSet: {
        storeId: storage.storeId,
        command: 'archive',
        subjectIds: docs.map(doc => doc.id),
        expectedVersions: storage.catalog
          .all()
          .map(item => ({ id: item.id, version: item.metadataVersion })),
        relationChanges: [],
        targetStatuses: docs.map(doc => ({
          artifactId: doc.id,
          status: 'archived' as const
        })),
        supplementDispositions: [],
        reason: REASON
      }
    },
    USER
  )
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'e2e'
  ).validatorSessionId!
  while (storage.lifecycle.jobs.readNext(prepared.id, sessionId).remaining) {
    // Reads every required document, as a validator must.
  }
  storage.lifecycle.jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  const transitionDocument = storage.create(
    {
      requestId: randomUUID(),
      body: '# Transition result\n\nThis document stays a draft.\n',
      metadata: { title: 'Transition result', tags: [] }
    },
    USER
  )
  const transitionPreview = storage.lifecycle.transitions.preview(
    transitionDocument.id,
    'archived',
    USER
  )
  const transition = storage.lifecycle.transitions.begin(
    {
      previewId: transitionPreview.previewId,
      presetId: 'e2e',
      requestId: randomUUID()
    },
    USER
  )
  const transitionSession = storage.lifecycle.jobs.get(
    transition.validationId!
  ).validatorSessionId!
  while (
    storage.lifecycle.jobs.readNext(transition.validationId!, transitionSession)
      .remaining
  ) {
    // The seeded validator reads the complete transition scope too.
  }
  storage.lifecycle.jobs.submit(transition.validationId!, transitionSession, {
    verdict: 'conflict',
    findings: [],
    resolutions: ['Keep this draft until its open question is resolved.']
  })
  storage.lifecycle.transitions.reconcile()
  writeFileSync(
    FIXTURE_PATH,
    JSON.stringify({
      documents: docs.map(doc => doc.id),
      changeSetId: proposal.id,
      version: proposal.version,
      validationId: prepared.id,
      storeId: storage.storeId,
      transitionDocumentId: transitionDocument.id,
      reason: REASON
    })
  )
  db.close()
}

seed()
const server = spawn(
  process.execPath,
  [
    join(import.meta.dirname, '../../dist/cli/index.js'),
    'serve',
    '--port',
    PORT,
    '--no-open'
  ],
  { cwd: root, stdio: 'inherit' }
)
function stop() {
  server.kill('SIGTERM')
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', code => {
  rmSync(root, { recursive: true, force: true })
  rmSync(FIXTURE_PATH, { force: true })
  process.exit(code ?? 0)
})
