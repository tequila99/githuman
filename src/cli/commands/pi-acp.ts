import * as acp from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { createPiAgent } from '../../server/adapters/pi-acp/agent.ts'

export function runPiAcp(argv: string[]): void {
  if (argv.length !== 1 || argv[0] !== '--stdio') {
    throw new Error('Usage: githuman pi-acp --stdio')
  }
  const profile = process.env.GITHUMAN_PI_PROFILE ?? 'chat'
  if (profile !== 'chat' && profile !== 'validator') {
    throw new Error('Invalid trusted pi launch profile')
  }
  const agent = createPiAgent(profile)
  agent.connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams have equivalent runtime contracts.
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
    )
  )
  const shutdown = () => {
    agent.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
