import type { AgentConfigOption } from '@/api/types'

/** The agent's setting of a semantic category (`model`, `mode`, …), if it has one. */
export function optionByCategory(
  options: readonly AgentConfigOption[],
  category: string
): AgentConfigOption | undefined {
  return options.find(o => o.category === category && o.type === 'select')
}

/**
 * The value after the current one in a select setting, wrapping around — what
 * Shift+Tab cycles the mode through. undefined when there is nothing to switch to.
 */
export function nextOptionValue(option: AgentConfigOption): string | undefined {
  const values = (option.options ?? []).map(choice => choice.value)
  if (values.length < 2) return undefined
  const index = values.indexOf(String(option.currentValue))
  return values[(index + 1) % values.length]
}
