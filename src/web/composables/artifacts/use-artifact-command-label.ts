import { useI18n } from 'vue-i18n'

/** A command the browser does not know yet shows as the server sent it. */
export function useArtifactCommandLabel() {
  const i18n = useI18n()
  return (command: string): string => {
    const key = `artifacts.actions.commands.${command}`
    return i18n.te(key) ? i18n.t(key) : command
  }
}
