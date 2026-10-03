import { useQuasar } from 'quasar'
import { errorMessage } from '@/utils/error-message'

export function useNotifyError() {
  const $q = useQuasar()
  return (message: string, error: unknown) => {
    $q.notify({ type: 'negative', message, caption: errorMessage(error) })
  }
}
