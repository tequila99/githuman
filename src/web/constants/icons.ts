import {
  mdiCheck,
  mdiContentCopy,
  mdiMessagePlusOutline,
  mdiRobotHappyOutline
} from '@mdi/js'

// Shared actions use the same shape in navigation, chat, and generated Markdown.
export const APP_ICONS = {
  agent: mdiRobotHappyOutline,
  addToChat: mdiMessagePlusOutline,
  copy: mdiContentCopy,
  done: mdiCheck
} as const
