import { useSyncExternalStore } from 'react'

// Global pause for the simulation ("freeze the screen while I talk"). Producers check isPaused()
// before generating anything, animation loops stop advancing, and CSS animations are paused via
// <html data-paused>. Resume continues where it stopped.
let paused = false
const listeners = new Set<() => void>()

export const isPaused = () => paused
export function setPaused(v: boolean) {
  if (v === paused) return
  paused = v
  if (v) document.documentElement.dataset.paused = ''
  else delete document.documentElement.dataset.paused
  listeners.forEach((l) => l())
}
export const togglePause = () => setPaused(!paused)
export const usePaused = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => paused)

// Message rate: a multiplier on every producer's delays. ] faster, [ slower, \ back to 1x.
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]
let speedIdx = 2
const speedListeners = new Set<() => void>()
export const getSpeed = () => SPEEDS[speedIdx]
/** Scale a delay in ms by the current rate (2x speed = half the delay). */
export const scaled = (ms: number) => ms / SPEEDS[speedIdx]
export function stepSpeed(d: number) {
  const next = Math.min(SPEEDS.length - 1, Math.max(0, speedIdx + d))
  if (next === speedIdx) return
  speedIdx = next
  document.documentElement.dataset.speed = String(SPEEDS[speedIdx])
  speedListeners.forEach((l) => l())
}
export const resetSpeed = () => stepSpeed(2 - speedIdx)
export const useSpeed = () => useSyncExternalStore((l) => (speedListeners.add(l), () => speedListeners.delete(l)), () => SPEEDS[speedIdx])
