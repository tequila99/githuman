import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { PROJECT_TEXT_LIMIT } from '../../../src/shared/project-files/constants.ts'

const url = (route: string, path: string) =>
  `/api/project-files/${route}?${new URLSearchParams({ path })}`

test('project files include untracked PDF, Unicode text, and passive downloads', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(() => app.close())
  const pdf = Buffer.from('%PDF-1.7\nexample\n%%EOF')
  await writeFile(join(fixture.dir, 'a.pdf'), pdf)
  await writeFile(join(fixture.dir, 'текст #%.md'), '# Hello\n')
  await writeFile(join(fixture.dir, 'page.html'), '<script>alert(1)</script>')
  const metadata = await app.inject(url('metadata', 'a.pdf'))
  assert.equal(metadata.statusCode, 200)
  assert.deepEqual(metadata.json(), {
    name: 'a.pdf',
    size: pdf.length,
    kind: 'pdf',
    mime: 'application/pdf',
    previewable: true
  })
  const content = await app.inject(url('content', 'a.pdf'))
  assert.equal(content.headers['content-type'], 'application/pdf')
  assert.deepEqual(content.rawPayload, pdf)
  assert.equal(content.headers['x-content-type-options'], 'nosniff')
  const text = await app.inject(url('content', 'текст #%.md'))
  assert.equal(text.body, '# Hello\n')
  assert.match(
    String(text.headers['content-disposition']),
    /filename\*=UTF-8''/
  )
  assert.equal((await app.inject(url('content', 'page.html'))).statusCode, 400)
  const download = await app.inject(
    url('content', 'page.html') + '&download=true'
  )
  assert.equal(download.statusCode, 200)
  assert.equal(download.headers['content-type'], 'application/octet-stream')
  assert.match(String(download.headers['content-disposition']), /^attachment;/)
})

test('project file endpoints reject traversal, symlinks, directories and missing files', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(() => app.close())
  await symlink('/etc/passwd', join(fixture.dir, 'outside'))
  await mkdir(join(fixture.dir, 'directory'))
  for (const route of ['metadata', 'content']) {
    for (const path of [
      '../outside',
      'outside',
      '/etc/passwd',
      'bad\0name',
      'bad\\path',
      'directory',
      'missing.pdf'
    ]) {
      const response = await app.inject(url(route, path))
      assert.ok(
        [400, 403, 404].includes(response.statusCode),
        `${route} ${path}: ${response.statusCode}`
      )
    }
  }
  await writeFile(join(fixture.dir, 'inside.txt'), 'inside')
  await symlink(join(fixture.dir, 'inside.txt'), join(fixture.dir, 'link.txt'))
  assert.equal((await app.inject(url('content', 'link.txt'))).body, 'inside')
})

test('content rechecks size after metadata and permits bounded-memory downloads', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(() => app.close())
  const path = join(fixture.dir, 'growing.txt')
  await writeFile(path, 'small')
  assert.equal(
    (await app.inject(url('metadata', 'growing.txt'))).json().previewable,
    true
  )
  await writeFile(path, 'x'.repeat(PROJECT_TEXT_LIMIT + 1))
  assert.equal(
    (await app.inject(url('metadata', 'growing.txt'))).json().previewable,
    false
  )
  assert.equal(
    (await app.inject(url('content', 'growing.txt'))).statusCode,
    400
  )
  const download = await app.inject(
    url('content', 'growing.txt') + '&download=true'
  )
  assert.equal(download.statusCode, 200)
  assert.equal(download.rawPayload.length, PROJECT_TEXT_LIMIT + 1)
})

test('project file access requires pairing on LAN and origins ignore the Host header', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await writeFile(join(fixture.dir, 'private.txt'), 'paired content')
  const app = buildApp({
    repositoryPath: fixture.dir,
    allowedHosts: ['192.168.1.10']
  })
  t.after(() => app.close())
  const lan = (path: string, cookie = '') =>
    app.inject({
      url: path,
      remoteAddress: '192.168.1.5',
      headers: { host: '192.168.1.10:3847', cookie }
    })
  for (const path of [
    url('metadata', 'private.txt'),
    url('content', 'private.txt'),
    '/api/project-files/context'
  ]) {
    assert.equal((await lan(path)).statusCode, 401)
  }
  const pending = await app.inject({
    method: 'POST',
    url: '/api/devices/requests',
    remoteAddress: '192.168.1.5',
    headers: { host: '192.168.1.10:3847' },
    payload: {}
  })
  const devices = (await app.inject('/api/devices')).json<
    Array<{ id: string }>
  >()
  const approval = await app.inject({
    method: 'POST',
    url: `/api/devices/${devices[0].id}/approve`,
    payload: { code: pending.json().pairing.code }
  })
  assert.equal(approval.statusCode, 200)
  const cookie = pending.cookies[0]
  const response = await lan(
    url('content', 'private.txt'),
    `${cookie.name}=${cookie.value}`
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.body, 'paired content')
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const context = (
    await lan('/api/project-files/context', `${cookie.name}=${cookie.value}`)
  ).json()
  assert.deepEqual(context.origins, [
    `http://localhost:${address.port}`,
    `http://127.0.0.1:${address.port}`,
    `http://[::1]:${address.port}`
  ])
})

test('text detection validates the whole file, not only the prefix', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(() => app.close())
  const prefix = Buffer.alloc(8192, 'A')
  await writeFile(
    join(fixture.dir, 'binary.dat'),
    Buffer.concat([prefix, Buffer.from([0x00, 0xff])])
  )
  // The last sequence is cut: 0xe2 0x82 needs one more byte.
  await writeFile(
    join(fixture.dir, 'cut.txt'),
    Buffer.concat([prefix, Buffer.from([0xe2, 0x82])])
  )
  // A multibyte character crosses the prefix boundary and is complete.
  await writeFile(
    join(fixture.dir, 'edge.txt'),
    Buffer.concat([
      Buffer.alloc(8191, 'A'),
      Buffer.from('€'),
      Buffer.from('end')
    ])
  )
  for (const name of ['binary.dat', 'cut.txt']) {
    const metadata = (await app.inject(url('metadata', name))).json()
    assert.equal(metadata.kind, 'download', name)
    assert.equal(metadata.previewable, false, name)
  }
  const edge = (await app.inject(url('metadata', 'edge.txt'))).json()
  assert.equal(edge.kind, 'text')
  assert.equal(edge.previewable, true)
})
