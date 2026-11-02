import { fstatSync, readdirSync, writeSync } from 'node:fs'

// Stdin survives Node startup when bash duplicates an inherited descriptor onto it.
const fds =
  process.argv[2] === 'all'
    ? readdirSync('/dev/fd')
        .map(Number)
        .filter(Number.isInteger)
        .map(fd => identity(fd))
    : [identity(Number(process.argv[2]), 0)]
const channels = JSON.parse(process.argv[3] ?? '[]')
if (
  fds.some(fd =>
    channels.some(channel => channel.dev === fd.dev && channel.ino === fd.ino)
  )
) {
  try {
    writeSync(0, 'child-injection\n')
  } catch {
    /* A read-only channel still fails the identity assertion. */
  }
}
console.log(
  JSON.stringify({ noncePresent: 'GITHUMAN_SPIKE_NONCE' in process.env, fds })
)

function identity(fd, source = fd) {
  try {
    const stat = fstatSync(source)
    return { fd, dev: stat.dev, ino: stat.ino }
  } catch {
    return { fd, closed: true }
  }
}
