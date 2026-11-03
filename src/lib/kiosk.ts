import { useCallback, useEffect, useRef, useState } from 'react'

// Booth kiosk: glides down the page on its own. It pauses at the top of each
// section, then scrolls slowly through anything taller than the screen, and
// rewinds to the top at the end. Touch, wheel or keys pause it; it resumes
// after IDLE_MS of inactivity, or straight away from the toggle button.

const SPEED_PX_S = 90 // reading speed when gliding through a tall section
const TOP_DWELL_MS = 7000
const BOTTOM_DWELL_MS = 5000
const START_DELAY_MS = 1500
const IDLE_MS = 45_000

type Waypoint = { y: number; dwell: number }

function waypoints(ids: string[]): Waypoint[] {
  const vh = window.innerHeight
  const max = document.documentElement.scrollHeight - vh
  const out: Waypoint[] = []
  for (const id of ids) {
    const el = document.getElementById(id)
    if (!el) continue
    const r = el.getBoundingClientRect()
    const top = Math.min(max, Math.max(0, r.top + window.scrollY))
    const bottom = Math.min(max, r.bottom + window.scrollY - vh)
    out.push({ y: top, dwell: TOP_DWELL_MS })
    if (bottom - top > 40) out.push({ y: bottom, dwell: BOTTOM_DWELL_MS })
  }
  return out
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

export function useKiosk(sectionIds: string[]) {
  const [on, setOn] = useState(() => new URLSearchParams(location.search).has('kiosk'))
  const [paused, setPaused] = useState(false)
  const idleTimer = useRef<number>()

  // Driver: always plans from the current scroll position, so resuming after
  // a visitor has scrolled around continues from wherever they left it.
  useEffect(() => {
    if (!on || paused) return
    let raf = 0, timer = 0

    const glide = (to: number, ms: number, done: () => void) => {
      const from = window.scrollY, t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms)
        window.scrollTo({ top: from + (to - from) * ease(k), behavior: 'instant' })
        if (k < 1) raf = requestAnimationFrame(step)
        else done()
      }
      raf = requestAnimationFrame(step)
    }

    const next = () => {
      const cur = window.scrollY
      const target = waypoints(sectionIds).find((w) => w.y > cur + 8)
      if (!target) {
        glide(0, 3000, () => (timer = window.setTimeout(next, TOP_DWELL_MS)))
        return
      }
      const ms = Math.min(9000, Math.max(1200, ((target.y - cur) / SPEED_PX_S) * 1000))
      glide(target.y, ms, () => (timer = window.setTimeout(next, target.dwell)))
    }

    timer = window.setTimeout(next, START_DELAY_MS)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [on, paused, sectionIds])

  // Any visitor interaction pauses the tour (except the toggle and app shortcuts).
  useEffect(() => {
    if (!on) return
    const poke = (e: Event) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-kiosk-toggle]')) return
      if (e instanceof KeyboardEvent && ['k', 't', 'f'].includes(e.key.toLowerCase())) return
      setPaused(true)
      clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => setPaused(false), IDLE_MS)
    }
    const evs = ['pointerdown', 'wheel', 'keydown', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, poke, { passive: true }))
    return () => { evs.forEach((e) => window.removeEventListener(e, poke)); clearTimeout(idleTimer.current) }
  }, [on])

  // Keep the booth screen awake while touring.
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    const acquire = () => {
      if (document.visibilityState === 'visible')
        navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => { document.removeEventListener('visibilitychange', acquire); lock?.release().catch(() => {}) }
  }, [on])

  // Off → start. Touring → stop. Paused → resume immediately.
  const toggle = useCallback(() => {
    clearTimeout(idleTimer.current)
    if (on && paused) { setPaused(false); return }
    setPaused(false)
    setOn((v) => !v)
  }, [on, paused])

  return { on, paused, toggle }
}
