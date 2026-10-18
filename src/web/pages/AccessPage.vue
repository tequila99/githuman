<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useInterval } from 'quasar'
import { useI18n } from 'vue-i18n'
import { DEVICE_NAME_MAX_LENGTH } from '@/api/types'
import { useAccessStore } from '@/stores/access-store'
import { useCountdown } from '@/composables/use-countdown'
import { useAppTheme } from '@/composables/use-app-theme'
import { errorMessage } from '@/utils/error-message'

// The device asks the server this often while it waits for the operator.
const POLL_MS = 2000

const { t } = useI18n()
const { isDark } = useAppTheme()
const access = useAccessStore()
const { status, pairing, pairingDeadline, mode, error } = storeToRefs(access)
const { registerInterval, removeInterval } = useInterval()
const countdown = useCountdown(() => pairingDeadline.value ?? undefined)

const name = shallowRef('')
const busy = shallowRef(false)
const requestError = shallowRef('')
// A request was pending and is gone: the operator rejected it, or it expired.
const ended = shallowRef(false)
// A request waits for the operator. A network error does not end the wait:
// the request lives on the server, so polling goes on.
const waiting = shallowRef(false)

const pending = computed(() => status.value === 'pending')

/** Checks the access; with access the app starts after a reload. */
async function check() {
  await access.check()
  if (mode.value === 'app') window.location.reload()
}

async function requestAccess() {
  if (busy.value) return
  busy.value = true
  requestError.value = ''
  ended.value = false
  try {
    await access.requestAccess(name.value.trim() || undefined)
    if (mode.value === 'app') window.location.reload()
  } catch (err) {
    requestError.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

watch(
  status,
  value => {
    if (value === 'pending') {
      waiting.value = true
    } else if (value !== null) {
      if (value === 'none' && waiting.value) ended.value = true
      waiting.value = false
    }
  },
  { immediate: true }
)

watch(
  waiting,
  value => {
    if (value) {
      registerInterval(() => void check(), POLL_MS)
    } else {
      removeInterval()
    }
  },
  { immediate: true }
)

onMounted(() => {
  // The boot already checked; a request can be pending from an earlier visit.
  if (pending.value) void check()
})
</script>

<template>
  <div class="access-page fullscreen flex flex-center q-pa-md">
    <q-card flat bordered class="access-page__card" :dark="isDark">
      <q-card-section>
        <div class="text-h6">{{ t('access.title') }}</div>
      </q-card-section>

      <q-card-section v-if="mode === 'unavailable'">
        <p>{{ t('access.unavailable') }}</p>
        <p v-if="error" class="text-caption text-negative">{{ error }}</p>
        <q-btn color="primary" :label="t('access.retry')" @click="check" />
      </q-card-section>

      <q-card-section v-else-if="pending && pairing">
        <p>{{ t('access.pending') }}</p>
        <div class="access-page__code text-primary" aria-live="polite">
          {{ pairing.code }}
        </div>
        <p class="text-caption">
          {{ t('access.expiresIn', { time: countdown.label.value }) }}
        </p>
      </q-card-section>

      <q-card-section v-else>
        <p>{{ t('access.noAccess') }}</p>
        <p v-if="ended" role="alert" class="text-warning">
          {{ t('access.ended') }}
        </p>
        <q-form class="column q-gutter-sm" @submit="requestAccess">
          <q-input
            v-model="name"
            dense
            outlined
            :maxlength="DEVICE_NAME_MAX_LENGTH"
            :label="t('access.nameLabel')"
            :disable="busy"
            :dark="isDark"
          />
          <q-btn
            color="primary"
            type="submit"
            :label="t('access.request')"
            :loading="busy"
          />
        </q-form>
        <p v-if="requestError" role="alert" class="text-negative q-mt-sm">
          {{ t('access.requestFailed') }}: {{ requestError }}
        </p>
      </q-card-section>

      <q-card-section class="text-caption text-grey-7">
        {{ t('access.httpWarning') }}
      </q-card-section>
    </q-card>
  </div>
</template>

<style scoped>
.access-page__card {
  width: 420px;
  max-width: 100%;
}
.access-page__code {
  font-family: var(--font-mono);
  font-size: 2.5rem;
  letter-spacing: 0.3em;
  text-align: center;
  margin: 16px 0;
}
</style>
