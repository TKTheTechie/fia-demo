import { motion, useScroll, useSpring } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import Architecture from './components/Architecture'
import Blotter from './components/Blotter'
import FormFactors from './components/FormFactors'
import Hero from './components/Hero'
import Latency from './components/Latency'
import Tape from './components/Tape'
import Throughput from './components/Throughput'
import TopicRouting from './components/TopicRouting'
import WanMap from './components/WanMap'
import { useKiosk } from './lib/kiosk'
import { useTheme } from './lib/theme'

const SECTION_IDS: string[] = []
const SECTIONS = [
  { id: 'top', label: 'Home' },
  { id: 'flow', label: 'End-to-end' },
  { id: 'topics', label: 'Topic routing' },
  { id: 'latency', label: 'Latency' },
  { id: 'wan', label: 'WAN' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'hybrid', label: 'Hybrid cloud' },
  { id: 'blotter', label: 'Blotter' },
]
SECTION_IDS.push(...SECTIONS.map((x) => x.id))

function useActiveSection() {
  const [active, setActive] = useState('top')
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -45% 0px' },
    )
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [])
  return active
}

function Logo() {
  return (
    <a href="#top" className="logo" style={{ textDecoration: 'none' }}>
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="6" fill="var(--brand)" />
        <g stroke="var(--brand)" strokeWidth="4" fill="none" strokeLinecap="round">
          <path d="M18 20a20 20 0 0 1 28 0"><animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite" /></path>
          <path d="M18 44a20 20 0 0 0 28 0"><animate attributeName="opacity" values="1;.3;1" dur="2s" begin=".5s" repeatCount="indefinite" /></path>
        </g>
      </svg>
      solace <small>· event mesh</small>
    </a>
  )
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const kiosk = useKiosk(SECTION_IDS)
  const active = useActiveSection()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    // circular reveal when the View Transitions API is available
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
    if (doc.startViewTransition) doc.startViewTransition(() => setTheme(next))
    else setTheme(next)
  }, [theme, setTheme])

  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const k = e.key.toLowerCase()
      if (k === 't') toggleTheme()
      if (k === 'k') kiosk.toggle()
      if (k === 'f') fullscreen()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [toggleTheme, kiosk])

  return (
    <>
      <div className="backdrop" />
      <motion.div className="kiosk-bar" style={{ scaleX, transformOrigin: '0 0', right: 0 }} />
      <nav className="nav">
        <Logo />
        <div className="nav-links">
          {SECTIONS.slice(1).map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'active' : ''}>{s.label}</a>
          ))}
        </div>
        <div className="nav-actions">
          <button
            data-kiosk-toggle
            className={`pill-btn ${kiosk.on ? 'on' : ''} ${kiosk.paused ? 'paused' : ''}`}
            onClick={kiosk.toggle}
            title={kiosk.on ? (kiosk.paused ? 'Resume the tour now (K)' : 'Stop the tour (K)') : 'Start booth auto-tour (K)'}
          >
            {kiosk.on && !kiosk.paused ? '■' : '▶'}<span>{kiosk.on ? (kiosk.paused ? 'Resume tour' : 'Stop tour') : 'Booth mode'}</span>
          </button>
          <button className="pill-btn" onClick={fullscreen} title="Fullscreen (F)" aria-label="Fullscreen">⛶</button>
          <button className="pill-btn" onClick={toggleTheme} title="Toggle theme (T)" aria-label="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </nav>
      <main>
        <Hero />
        <Tape />
        <Architecture />
        <TopicRouting />
        <Latency />
        <WanMap />
        <Throughput />
        <FormFactors />
        <Blotter />
      </main>
    </>
  )
}
