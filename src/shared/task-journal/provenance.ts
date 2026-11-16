import type { JournalProvenance } from './types.ts'

export function journalProvenance(
  context: JournalProvenance
): JournalProvenance {
  const { presetId, agentName, sessionName, model, reasoning, settings } =
    context
  return {
    presetId,
    agentName,
    sessionName,
    model,
    reasoning,
    settings: structuredClone(settings)
  }
}
