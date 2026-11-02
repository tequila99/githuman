<script setup lang="ts">
import { mdiCancel, mdiPencilOutline } from '@mdi/js'
import { computed, onMounted, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { addressUrl, DEVICE_NAME_MAX_LENGTH, type Device } from '@/api/types'
import { useDevicesStore } from '@/stores/devices-store'
import { useNotifyError } from '@/composables/use-notify-error'
import { formatDateTime } from '@/utils/date'
import DialogHeader from '@/components/DialogHeader.vue'
import QrCode from '@/components/devices/QrCode.vue'

// Port of an http: page without an explicit port.
const DEFAULT_HTTP_PORT = 80

const emit = defineEmits<{ close: [] }>()
const $q = useQuasar()
const { t } = useI18n()
const notifyError = useNotifyError()
const store = useDevicesStore()
const { lanAddresses, trusted } = storeToRefs(store)
const selected = shallowRef<string | null>(null)

// The port of this page: in dev mode it is the Quasar dev server, not the backend.
const urls = computed(() =>
  lanAddresses.value.map(address =>
    addressUrl(address, Number(window.location.port) || DEFAULT_HTTP_PORT)
  )
)
const url = computed(() => selected.value ?? urls.value[0] ?? null)

onMounted(async () => {
  try {
    await store.loadLanAddresses()
  } catch (err) {
    notifyError(t('devices.actionFailed'), err)
  }
})

function lastSeen(device: Device): string {
  return t('devices.lastSeen', {
    time: formatDateTime(device.lastSeenAt),
    address: device.address
  })
}

function rename(device: Device) {
  $q.dialog({
    title: t('devices.renameTitle'),
    prompt: {
      model: device.name,
      type: 'text',
      maxlength: DEVICE_NAME_MAX_LENGTH,
      isValid: (value: string) => value.trim().length > 0
    },
    cancel: { label: t('devices.cancel'), flat: true },
    ok: { label: t('devices.save') }
  }).onOk((name: string) => {
    store.rename(device.id, name.trim()).catch((err: unknown) => {
      notifyError(t('devices.actionFailed'), err)
    })
  })
}

function revoke(device: Device) {
  $q.dialog({
    title: t('devices.revokeTitle'),
    message: t('devices.revokeMessage', { name: device.name }),
    cancel: { label: t('devices.cancel'), flat: true },
    ok: { label: t('devices.revoke'), color: 'negative' }
  }).onOk(() => {
    store.revoke(device.id).catch((err: unknown) => {
      notifyError(t('devices.actionFailed'), err)
    })
  })
}
</script>

<template>
  <q-dialog :model-value="true" @hide="emit('close')">
    <q-card style="width: 480px; max-width: 90vw">
      <DialogHeader
        :title="t('devices.title')"
        :close-label="t('common.filters.close')"
      />

      <q-card-section>
        <div class="text-subtitle2">{{ t('devices.connect') }}</div>
        <p class="text-caption">{{ t('devices.connectHint') }}</p>
        <div v-if="url" class="devices-dialog__connection column items-center">
          <QrCode :value="url" :label="url" />
          <q-select
            v-if="urls.length > 1"
            :model-value="url"
            :options="urls"
            :label="t('devices.address')"
            dense
            outlined
            class="devices-dialog__address"
            @update:model-value="selected = $event"
          />
          <div v-else class="text-body2" style="font-family: var(--font-mono)">
            {{ url }}
          </div>
        </div>
        <p v-else class="text-caption text-grey-7">
          {{ t('devices.noAddresses') }}
        </p>
      </q-card-section>

      <q-separator />

      <q-card-section>
        <div class="text-subtitle2">{{ t('devices.trusted') }}</div>
        <q-list v-if="trusted.length > 0" dense class="devices-dialog__trusted">
          <q-item
            v-for="device in trusted"
            :key="device.id"
            class="devices-dialog__device"
          >
            <q-item-section>
              <q-item-label class="ellipsis" :title="device.name">{{
                device.name
              }}</q-item-label>
              <q-item-label caption lines="2" :title="lastSeen(device)">{{
                lastSeen(device)
              }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row no-wrap">
                <q-btn
                  class="app-icon-control"
                  flat
                  round
                  dense
                  :icon="mdiPencilOutline"
                  :aria-label="t('devices.rename')"
                  @click="rename(device)"
                />
                <q-btn
                  class="app-icon-control"
                  flat
                  round
                  dense
                  :icon="mdiCancel"
                  color="negative"
                  :aria-label="t('devices.revoke')"
                  @click="revoke(device)"
                />
              </div>
            </q-item-section>
          </q-item>
        </q-list>
        <p v-else class="text-caption text-grey-7">{{ t('devices.none') }}</p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.devices-dialog__connection {
  gap: 24px;
}
.devices-dialog__trusted {
  height: 144px;
  overflow-y: auto;
}
.devices-dialog__device {
  height: 72px;
}

.devices-dialog__address {
  width: 100%;
  font-family: var(--font-mono);
}
</style>
