import {
  computed,
  onMounted,
  shallowRef,
  toValue,
  type MaybeRefOrGetter
} from 'vue'
import { useInterval } from 'quasar'
import { formatRemaining } from '@/utils/format-remaining'

// The label shows seconds, so one tick per second is enough.
const TICK_MS = 1000

/** Time left until an ISO deadline, updated every second while the component lives. */
export function useCountdown(deadline: MaybeRefOrGetter<string | undefined>) {
  const now = shallowRef(Date.now())
  const { registerInterval } = useInterval()
  onMounted(() => registerInterval(() => (now.value = Date.now()), TICK_MS))

  const remainingMs = computed(() => {
    const value = toValue(deadline)
    return value === undefined ? 0 : Date.parse(value) - now.value
  })
  const expired = computed(() => remainingMs.value <= 0)
  const label = computed(() => formatRemaining(remainingMs.value))
  return { remainingMs, expired, label }
}
