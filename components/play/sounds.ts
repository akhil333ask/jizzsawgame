let ctx: AudioContext | null = null

/** Must be called from a user gesture (pointerdown) so mobile browsers allow audio later. */
export function unlockAudio() {
  if (typeof window === 'undefined') return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  ctx ??= new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
}

export function getAudioContext() {
  return ctx
}

function blip(freq: number, endFreq: number, duration: number, volume: number, type: OscillatorType, delay = 0) {
  if (!ctx) return
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration)
  gain.gain.setValueAtTime(volume, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

/** Short wooden "click" for a piece locking into place. */
export function playSnap() {
  blip(2200, 700, 0.045, 0.35, 'triangle')
  blip(900, 300, 0.07, 0.2, 'sine', 0.012)
}

export function playMiss() {
  blip(180, 120, 0.09, 0.12, 'sine')
}

export function playWin() {
  ;[523, 659, 784, 1047].forEach((f, i) => blip(f, f, 0.16, 0.18, 'triangle', i * 0.1))
}
