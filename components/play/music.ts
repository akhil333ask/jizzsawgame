'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { getAudioContext, unlockAudio } from './sounds'

export type MusicScene = 'intro' | 'play' | 'leaderboard'

const tracks = (name: MusicScene) => [1, 2, 3, 4, 5].map((n) => `/audio/${name}-${n}.mp3`)

const PLAYLISTS: Record<MusicScene, string[]> = {
  intro: tracks('intro'),
  play: tracks('play'),
  leaderboard: tracks('leaderboard'),
}

/** Background levels: quiet enough to sit under the sound effects, and lowest while solving. */
const SCENE_VOLUME: Record<MusicScene, number> = {
  intro: 0.16,
  play: 0.08,
  leaderboard: 0.16,
}

const sceneVolume = () => (scene ? SCENE_VOLUME[scene] : 0)
const FADE_IN_S = 3
const FADE_OUT_S = 0.8
const MUTE_KEY = 'pokepuzzle:music-muted'

let audio: HTMLAudioElement | null = null
let gain: GainNode | null = null
let scene: MusicScene | null = null
let loadedScene: MusicScene | null = null
let queue: string[] = []
let lastTrack: string | null = null
let gestureBound = false
let pauseTimer: ReturnType<typeof setTimeout> | null = null
let muted = typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === '1'
const listeners = new Set<() => void>()

function shuffled(tracks: string[]) {
  const list = [...tracks]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  // Avoid replaying the song that just finished when the playlist reshuffles.
  if (list.length > 1 && list[0] === lastTrack) list.push(list.shift()!)
  return list
}

function nextTrack(current: MusicScene) {
  if (queue.length === 0) queue = shuffled(PLAYLISTS[current])
  lastTrack = queue.shift()!
  return lastTrack
}

/**
 * Volume goes through a Web Audio gain node because iOS (including Telegram's in-app browser)
 * ignores HTMLAudioElement.volume, which would otherwise play the music at full loudness.
 */
function ensureGraph() {
  const ctx = getAudioContext()
  if (!ctx) return null
  if (!audio) {
    audio = new Audio()
    audio.preload = 'none'
    audio.addEventListener('ended', () => {
      if (scene) void playFresh(scene)
    })
    gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination)
  }
  return ctx
}

function rampTo(target: number, seconds: number) {
  const ctx = getAudioContext()
  if (!ctx || !gain) return
  const t = ctx.currentTime
  gain.gain.cancelScheduledValues(t)
  gain.gain.setValueAtTime(gain.gain.value, t)
  gain.gain.linearRampToValueAtTime(target, t + seconds)
}

async function playFresh(current: MusicScene) {
  if (!ensureGraph() || !audio || !gain) return
  audio.src = nextTrack(current)
  loadedScene = current
  gain.gain.value = 0
  try {
    await audio.play()
    if (scene === current && !muted) rampTo(sceneVolume(), FADE_IN_S)
  } catch {
    // Autoplay was refused; the next tap will retry.
  }
}

function resume() {
  if (!scene || muted || document.hidden) return
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = null
  if (!ensureGraph() || !audio) return
  if (loadedScene && loadedScene !== scene && !audio.paused) {
    // Fade the previous screen's song out before the new playlist fades in.
    const target = scene
    rampTo(0, FADE_OUT_S)
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      if (scene === target) void playFresh(target)
    }, FADE_OUT_S * 1000)
  } else if (!audio.src || audio.ended || loadedScene !== scene) {
    void playFresh(scene)
  } else if (audio.paused) {
    void audio.play().then(() => rampTo(sceneVolume(), FADE_IN_S)).catch(() => {})
  } else {
    rampTo(sceneVolume(), FADE_IN_S)
  }
}

function fadeOutAndPause() {
  rampTo(0, FADE_OUT_S)
  if (pauseTimer) clearTimeout(pauseTimer)
  pauseTimer = setTimeout(() => audio?.pause(), FADE_OUT_S * 1000 + 50)
}

/** Browsers only allow sound after a user gesture, so the first tap anywhere starts the music. */
function bindGesture() {
  if (gestureBound || typeof window === 'undefined') return
  gestureBound = true
  const onGesture = () => {
    unlockAudio()
    resume()
  }
  window.addEventListener('pointerdown', onGesture, { capture: true })
  window.addEventListener('keydown', onGesture, { capture: true })
  document.addEventListener('visibilitychange', () => (document.hidden ? audio?.pause() : resume()))
}

function setScene(next: MusicScene | null) {
  if (next === scene) return
  scene = next
  if (!next) return fadeOutAndPause()
  if (loadedScene !== next) queue = []
  resume()
}

export function setMusicMuted(value: boolean) {
  muted = value
  window.localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  if (value) fadeOutAndPause()
  else {
    unlockAudio()
    resume()
  }
  listeners.forEach((l) => l())
}

/** Plays the scene's shuffled playlist while mounted and fades out when the scene ends. */
export function useMusicScene(next: MusicScene | null) {
  useEffect(() => {
    bindGesture()
    setScene(next)
  }, [next])
  useEffect(() => () => setScene(null), [])
}

export function useMusicMuted() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => muted,
    () => false,
  )
}
