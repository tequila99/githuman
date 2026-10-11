import { onScopeDispose, readonly, shallowRef, watch, type Ref } from 'vue'
import { useAnimationFrame } from 'quasar'

// Focus the four bars on the frequency range of speech.
const BAND_EDGES_HZ = [120, 520, 1040, 2080, 4160]
// Keep the active state visible even in silence.
const MIN_BAR_SCALE = 0.16
// Balance frequency detail and the cost of sampling a small control.
const FFT_SIZE = 512
// Smooth short changes without delaying the response to speech.
const SMOOTHING = 0.65
// Ignore low background noise and amplify normal speech.
const NOISE_FLOOR = 0.12
const SENSITIVITY = 1.4
// Quiet room noise sits below this level, so the bars stay at rest.
const MIN_DECIBELS = -85
// Normal speech at a desk microphone stays below this level, so the bars do not clip.
const MAX_DECIBELS = -25

interface SpectrumServices {
  getUserMedia: () => Promise<MediaStream>
  createAudioContext: () => AudioContext
  registerAnimationFrame: (callback: () => void) => void
  removeAnimationFrame: () => void
}

interface SpectrumRun {
  context: AudioContext
  stream: MediaStream | null
}

export function useSpeechSpectrum(
  listening: Ref<boolean>,
  services?: SpectrumServices
) {
  const frames = services ?? useAnimationFrame()
  const bars = shallowRef(BAND_EDGES_HZ.slice(1).map(() => MIN_BAR_SCALE))
  let current: SpectrumRun | null = null

  function stop() {
    const run = current
    current = null
    frames.removeAnimationFrame()
    bars.value = bars.value.map(() => MIN_BAR_SCALE)
    if (!run) return
    run.stream?.getTracks().forEach(track => track.stop())
    void run.context.close().catch(() => undefined)
  }

  async function start() {
    let run: SpectrumRun | null = null
    try {
      const context = services
        ? services.createAudioContext()
        : new AudioContext()
      run = { context, stream: null }
      current = run
      // Resume inside the user gesture, before waiting for microphone permission.
      void context.resume().catch(() => undefined)
      const stream = await (services
        ? services.getUserMedia()
        : navigator.mediaDevices.getUserMedia({ audio: true }))
      if (current !== run) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      run.stream = stream
      const analyser = context.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = SMOOTHING
      analyser.minDecibels = MIN_DECIBELS
      analyser.maxDecibels = MAX_DECIBELS
      // Do not connect to the output: monitoring must never play microphone audio.
      context.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const binHz = context.sampleRate / FFT_SIZE
      const bands = BAND_EDGES_HZ.slice(1).map((end, index) => ({
        start: Math.max(1, Math.floor(BAND_EDGES_HZ[index]! / binHz)),
        end: Math.min(data.length, Math.ceil(end / binHz))
      }))
      function sample() {
        if (current !== run) return
        try {
          analyser.getByteFrequencyData(data)
          bars.value = bands.map(band => {
            let sum = 0
            for (let i = band.start; i < band.end; i++) sum += data[i]!
            const level = sum / Math.max(1, band.end - band.start) / 255
            const strength = Math.min(
              1,
              Math.max(0, level - NOISE_FLOOR) * SENSITIVITY
            )
            return MIN_BAR_SCALE + (1 - MIN_BAR_SCALE) * strength
          })
          frames.registerAnimationFrame(sample)
        } catch {
          stop()
        }
      }
      sample()
    } catch {
      // Visualization failure must not interrupt speech recognition.
      if (current === run) stop()
    }
  }

  watch(
    listening,
    active => {
      stop()
      if (active) void start()
    },
    { flush: 'sync', immediate: true }
  )
  onScopeDispose(stop)
  return { bars: readonly(bars) }
}
