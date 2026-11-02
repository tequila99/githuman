import { fileURLToPath } from 'node:url'
import type { AgentPreset } from '../../../shared/agents/types.ts'

export function localPiLaunch(): { command: string; args: string[] } {
  const entry = import.meta.url.endsWith('.ts')
    ? '../../../cli/index.ts'
    : '../../../cli/index.js'
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL(entry, import.meta.url)), 'pi-acp', '--stdio']
  }
}

export function isLocalPiLaunch(preset: AgentPreset): boolean {
  const trusted = localPiLaunch()
  return (
    preset.command === trusted.command &&
    preset.args.length === trusted.args.length &&
    preset.args.every((arg, index) => arg === trusted.args[index])
  )
}
