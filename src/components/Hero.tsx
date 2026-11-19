import { motion } from 'framer-motion'
import { Component, ReactNode, Suspense, lazy, useEffect, useState } from 'react'
import { broker } from '../lib/broker'
import { useScenario } from '../lib/scenario'
import { stageSubscription } from '../lib/sim/lifecycle'
import type { Scenario } from '../scenarios/types'

const HeroScene = lazy(() => import('./HeroScene'))

// If WebGL is unavailable (old GPU driver, disabled acceleration) drop the
// globe rather than taking the whole page down with it.
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

function useLiveStats(sc: Scenario) {
  const [s, setS] = useState({ rate: 0, total: 0, orders: 0 })
  useEffect(() => {
    let lastN = broker.published, lastT = performance.now(), orders = 0
    const un = broker.subscribe(stageSubscription(sc, sc.lifecycle.stages[0].id), () => orders++)
    const iv = setInterval(() => {
      const now = performance.now()
      const rate = ((broker.published - lastN) / (now - lastT)) * 1000
      lastN = broker.published; lastT = now
      setS({ rate, total: broker.published, orders })
    }, 500)
    return () => { un(); clearInterval(iv) }
  }, [sc])
  return s
}

export default function Hero() {
  const sc = useScenario()
  const HERO = sc.hero
  const clients = HERO.clients
  const s = useLiveStats(sc)
  return (
    <section className="hero" id="top">
      <div className="hero-canvas">
        <SceneBoundary><Suspense fallback={null}><HeroScene /></Suspense></SceneBoundary>
      </div>
      <div className="wrap hero-content">
        <motion.div className="eyebrow" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
          {HERO.eyebrow}
        </motion.div>
        <h1>
          {HERO.title.map((line, li) => (
            <span key={li} style={{ display: 'block', overflow: 'hidden' }}>
              <motion.span
                style={{ display: 'inline-block' }}
                className={li === 1 ? 'grad' : ''}
                initial={{ y: '110%' }}
                animate={{ y: 0 }}
                transition={{ duration: 1, delay: 0.15 + li * 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.p className="lede" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.8 }}>
          {HERO.lede}
        </motion.p>
        <motion.div className="hero-stats" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.8 }}>
          <div className="stat"><b>{s.rate.toFixed(0)}</b><span>events / sec on this page</span></div>
          <div className="stat"><b>{s.total.toLocaleString()}</b><span>events routed</span></div>
          <div className="stat"><b>{s.orders.toLocaleString()}</b><span>{sc.lifecycle.noun}s through the mesh</span></div>
        </motion.div>
      </div>
      {clients && (
        <motion.div className="clients" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 1 }}>
          <div className="clients-label mono">{clients.label}</div>
          <div className="clients-window">
            <div className="clients-track">
              {[...clients.items, ...clients.items].map((c, i) => (
                <div key={i} className={`client ${c.serif ? 'serif' : ''}`} title={c.name} aria-hidden={i >= clients.items.length}>
                  {c.logo ? <img src={c.logo} alt={c.name} /> : c.short ?? c.name}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </section>
  )
}
