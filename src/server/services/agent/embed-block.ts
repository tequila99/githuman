import type { ContentBlock } from '@agentclientprotocol/sdk'

function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map(run => run.length)
  )
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Text the agent cannot fetch on its own goes in as an embedded resource when
 * the agent supports it, otherwise as a fenced block in a plain text part.
 * The fence is longer than any backtick run, so the content cannot close it.
 */
export function embedBlock(
  embeddedContext: boolean,
  uri: string,
  title: string,
  mimeType: string,
  body: string
): ContentBlock {
  if (embeddedContext) {
    return { type: 'resource', resource: { uri, mimeType, text: body } }
  }
  const fence = fenceFor(body)
  return { type: 'text', text: `${title}\n${fence}\n${body}\n${fence}` }
}
