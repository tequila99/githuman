import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { useSpeechSpectrum } from '@/composables/use-speech-spectrum'

function setup(pending = false) {
  const listening = ref(false)
  let frame: (() => void) | undefined
  let stopped = 0
  let closed = 0
  let signal = 0
  let outputConnections = 0
  let resolve!: (stream: MediaStream) => void
  let reject!: (error: Error) => void
  const stream = {
    getTracks: () => [{ stop: () => stopped++ }]
  } as unknown as MediaStream
  const analyser = {
    frequencyBinCount: 256,
    getByteFrequencyData: (data: Uint8Array) => data.fill(signal)
  }
  const context = {
    sampleRate: 48000,
    resume: async () => {},
    close: async () => {
      closed++
    },
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({
      connect: (target: unknown) => {
        if (target !== analyser) outputConnections++
      }
    })
  } as unknown as AudioContext
  const scope = effectScope()
  const spectrum = scope.run(() =>
    useSpeechSpectrum(listening, {
      getUserMedia: () =>
        pending
          ? new Promise<MediaStream>((done, fail) => {
              resolve = done
              reject = fail
            })
          : Promise.resolve(stream),
      createAudioContext: () => context,
      registerAnimationFrame: callback => {
        frame = callback
      },
      removeAnimationFrame: () => {
        frame = undefined
      }
    })
  )!
  return {
    listening,
    scope,
    spectrum,
    stream,
    pendingRequest: () => {
      const done = resolve
      const fail = reject
      return {
        resolve: () => done(stream),
        reject: () => fail(new Error('permission denied'))
      }
    },
    resolve: () => resolve(stream),
    reject: () => reject(new Error('permission denied')),
    signal: (value: number) => {
      signal = value
    },
    tick: () => frame?.(),
    state: () => ({ stopped, closed, hasFrame: !!frame, outputConnections })
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

test('four bars react to audio and return to silence without audio playback', async t => {
  const check = setup()
  t.after(() => check.scope.stop())
  check.listening.value = true
  await flush()
  const silent = [...check.spectrum.bars.value]
  assert.equal(silent.length, 4)
  check.signal(210)
  check.tick()
  assert.ok(
    check.spectrum.bars.value.every(
      (value, index) => value > silent[index]! && value <= 1
    )
  )
  check.signal(0)
  check.tick()
  assert.deepEqual([...check.spectrum.bars.value], silent)
  assert.equal(check.state().outputConnections, 0)
  check.listening.value = false
  assert.deepEqual(check.state(), {
    stopped: 1,
    closed: 1,
    hasFrame: false,
    outputConnections: 0
  })
})

test('permission granted after stopping releases the late microphone stream', async t => {
  const check = setup(true)
  t.after(() => check.scope.stop())
  check.listening.value = true
  check.listening.value = false
  check.resolve()
  await flush()
  assert.deepEqual(check.state(), {
    stopped: 1,
    closed: 1,
    hasFrame: false,
    outputConnections: 0
  })
})

test('scope disposal stops microphone capture and scheduled frames', async () => {
  const check = setup()
  check.listening.value = true
  await flush()
  check.scope.stop()
  assert.deepEqual(check.state(), {
    stopped: 1,
    closed: 1,
    hasFrame: false,
    outputConnections: 0
  })
})

test('permission failure leaves static bars and does not change recognition state', async t => {
  const check = setup(true)
  t.after(() => check.scope.stop())
  const silent = [...check.spectrum.bars.value]
  check.listening.value = true
  check.reject()
  await flush()
  assert.equal(check.listening.value, true)
  assert.deepEqual([...check.spectrum.bars.value], silent)
  assert.equal(check.state().closed, 1)
  assert.equal(check.state().hasFrame, false)
})

test('permission granted after scope disposal still releases the stream', async () => {
  const check = setup(true)
  check.listening.value = true
  check.scope.stop()
  check.resolve()
  await flush()
  assert.equal(check.state().stopped, 1)
  assert.equal(check.state().closed, 1)
  assert.equal(check.state().hasFrame, false)
})

test('a stale permission failure cannot stop a newer capture', async t => {
  const check = setup(true)
  t.after(() => check.scope.stop())
  check.listening.value = true
  const old = check.pendingRequest()
  check.listening.value = false
  check.listening.value = true
  check.resolve()
  await flush()
  old.reject()
  await flush()
  assert.equal(check.state().closed, 1)
  assert.equal(check.state().stopped, 0)
  assert.equal(check.state().hasFrame, true)
  check.listening.value = false
  assert.equal(check.state().closed, 2)
  assert.equal(check.state().stopped, 1)
})
