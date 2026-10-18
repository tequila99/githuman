<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { PAIRING_CODE_LENGTH } from '@/api/types'
import { useDevicesStore } from '@/stores/devices-store'
import { useCountdown } from '@/composables/use-countdown'
import { errorMessage } from '@/utils/error-message'

const $q = useQuasar()
const { t } = useI18n()
const store = useDevicesStore()
const { pending } = storeToRefs(store)
const busy = shallowRef(false)
// The operator types the code from the device screen; the dialog never shows it.
const typedCode = shallowRef('')
const answerError = shallowRef('')

// Closing the dialog postpones a request: it stays pending on the server and
// returns through the notification. A closed request must not reopen at once.
const postponed = shallowRef<ReadonlySet<string>>(new Set())

// The oldest request first; the next one shows after an answer.
const request = computed(() =>
  pending.value.find(device => !postponed.value.has(device.id))
)
const countdown = useCountdown(() => request.value?.expiresAt)

const codeComplete = computed(
  () => typedCode.value.length === PAIRING_CODE_LENGTH
)

// A new request starts with an empty field and no old error.
watch(
  () => request.value?.id,
  () => {
    typedCode.value = ''
    answerError.value = ''
  }
)

// An expired request leaves the list only when the server is asked again.
watch(countdown.expired, expired => {
  if (expired && request.value) void store.refresh()
})

function setPostponed(id: string, value: boolean) {
  const next = new Set(postponed.value)
  if (value) {
    next.add(id)
  } else {
    next.delete(id)
  }
  postponed.value = next
}

// A request that left the list needs no mark any more.
watch(pending, list => {
  const ids = new Set(list.map(device => device.id))
  const kept = [...postponed.value].filter(id => ids.has(id))
  if (kept.length !== postponed.value.size) postponed.value = new Set(kept)
})

function postpone() {
  const device = request.value
  if (!device || busy.value) return
  setPostponed(device.id, true)
  $q.notify({
    type: 'warning',
    message: t('devices.request.postponed', { name: device.name }),
    timeout: 0,
    actions: [
      {
        label: t('devices.request.answer'),
        color: 'white',
        handler: () => setPostponed(device.id, false)
      },
      { icon: 'close', color: 'white', round: true, dense: true }
    ]
  })
}

async function answer(approve: boolean) {
  const device = request.value
  if (!device || busy.value) return
  if (approve && !codeComplete.value) return
  busy.value = true
  answerError.value = ''
  try {
    if (approve) {
      await store.approve(device, typedCode.value)
    } else {
      await store.revoke(device.id)
    }
  } catch (err) {
    // 404, 409 and 410: the list is refreshed, and the dialog shows the next state.
    // After a wrong code the same request stays: the field is empty for a new try.
    answerError.value = `${t('devices.request.failed')}: ${errorMessage(err)}`
    typedCode.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <q-dialog :model-value="request !== undefined" @update:model-value="postpone">
    <q-card v-if="request" style="width: 360px; max-width: 90vw">
      <q-form @submit="answer(true)">
        <q-card-section class="q-pb-none text-h6">
          {{ t('devices.request.title') }}
        </q-card-section>
        <q-card-section class="q-gutter-y-sm">
          <div>
            {{
              t('devices.request.from', {
                name: request.name,
                address: request.address,
                host: request.host
              })
            }}
          </div>
          <q-input
            v-model="typedCode"
            dense
            outlined
            autofocus
            inputmode="numeric"
            autocomplete="off"
            :mask="'#'.repeat(PAIRING_CODE_LENGTH)"
            unmasked-value
            input-class="device-request__code"
            :label="t('devices.request.code')"
            :disable="busy || countdown.expired.value"
            :error="answerError !== ''"
            :error-message="answerError"
          />
          <div class="text-caption text-grey-7">
            {{
              countdown.expired.value
                ? t('devices.request.expired')
                : t('devices.request.expiresIn', {
                    time: countdown.label.value
                  })
            }}
          </div>
          <div class="text-caption text-grey-7">
            {{ t('devices.request.warning') }}
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn
            flat
            :label="t('devices.request.reject')"
            :disable="busy"
            @click="answer(false)"
          />
          <q-btn
            color="primary"
            type="submit"
            :label="t('devices.request.approve')"
            :loading="busy"
            :disable="!codeComplete || countdown.expired.value"
          />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.device-request__code {
  font-family: var(--font-mono);
  letter-spacing: 0.3em;
}
</style>
