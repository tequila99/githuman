import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'

export interface GitFixture {
  dir: string
  git: SimpleGit
  cleanup: () => void
}

export async function createTempGitRepo(): Promise<GitFixture> {
  const dir = mkdtempSync(join(tmpdir(), 'githuman-vue-git-'))
  const git = simpleGit(dir)

  await git.init(['--initial-branch=main'])
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'Test')

  return {
    dir,
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}
