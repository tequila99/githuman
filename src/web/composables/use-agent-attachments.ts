import { toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useAgentStore } from '@/stores/agent-store'
import {
  AttachmentTooLargeError,
  MAX_ATTACHMENT_BYTES,
  readAttachment
} from '@/utils/attachments'
import { useNotifyError } from './use-notify-error'

export function useAgentAttachments(chatId: MaybeRefOrGetter<string>) {
  const store = useAgentStore()
  const { t } = useI18n()
  const $q = useQuasar()
  const notifyError = useNotifyError()
  async function attachFiles(files: Iterable<File>) {
    const id = toValue(chatId)
    for (const file of files) {
      try {
        store.addContext(await readAttachment(file), id)
      } catch (err) {
        if (err instanceof AttachmentTooLargeError) {
          $q.notify({
            type: 'negative',
            message: t('agent.attach.tooLarge', {
              name: file.name,
              mb: MAX_ATTACHMENT_BYTES / 1024 / 1024
            })
          })
        } else {
          notifyError(t('agent.attach.readFailed'), err)
        }
      }
    }
  }

  return { attachFiles }
}
