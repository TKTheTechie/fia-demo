import { motion } from 'framer-motion'
import { MouseEvent, useState } from 'react'
import { FORM_FACTORS, PROTOCOLS } from '../content'
import { SectionHead, Reveal } from './Section'

function Icon({ k }: { k: string }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (k === 'appliance') return (
    <svg viewBox="0 0 64 64" {...s}><rect x="6" y="14" width="52" height="12" rx="2" /><rect x="6" y="30" width="52" height="12" rx="2" /><rect x="6" y="46" width="52" height="8" rx="2" />
      {[0, 1, 2].map((i) => <circle key={i} cx={14 + i * 6} cy="20" r="1.4" fill="currentColor" className="blink" style={{ animationDelay: `${i * 0.3}s` }} />)}
      {[0, 1, 2].map((i) => <circle key={i} cx={14 + i * 6} cy="36" r="1.4" fill="currentColor" className="blink" style={{ animationDelay: `${i * 0.4 + 0.2}s` }} />)}
      <path d="M38 20h14M38 36h14" /></svg>)
  if (k === 'software') return (
    <svg viewBox="0 0 64 64" {...s}><path d="M32 6l22 12v28L32 58 10 46V18z" /><path d="M32 30l22-12M32 30L10 18M32 30v28" /><path d="M21 12l22 12" opacity=".4" /></svg>)
  if (k === 'cloud') return (
    <svg viewBox="0 0 64 64" {...s}><path d="M18 46a10 10 0 0 1-1-20 14 14 0 0 1 27-3 11 11 0 0 1 3 23z" /><path d="M24 54v-6M32 56v-8M40 54v-6" className="rain" /></svg>)
  return (
    <svg viewBox="0 0 64 64" {...s}><rect x="18" y="22" width="28" height="20" rx="3" /><path d="M32 22V12M32 52V42M18 32H8M56 32H46" /><circle cx="32" cy="10" r="3" /><circle cx="32" cy="54" r="3" /><circle cx="6" cy="32" r="3" /><circle cx="58" cy="32" r="3" /></svg>)
}

function TiltCard({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState({ x: 0, y: 0, mx: 50, my: 50 })
  const on = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height
    setT({ x: (py - 0.5) * -10, y: (px - 0.5) * 12, mx: px * 100, my: py * 100 })
  }
  return (
    <motion.div className="panel ff-card" onMouseMove={on} onMouseLeave={() => setT({ x: 0, y: 0, mx: 50, my: 50 })}
      animate={{ rotateX: t.x, rotateY: t.y }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      style={{ ['--mx' as string]: `${t.mx}%`, ['--my' as string]: `${t.my}%` }}>
      {children}
    </motion.div>
  )
}

export default function FormFactors() {
  return (
    <section id="hybrid" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="06 · Multi-form factor · Hybrid cloud"
          title={<>Same broker. <span className="grad">Anywhere</span> you run.</>}
          lede="Hardware in the colo, software in your data center, managed services in every major cloud — all speaking the same protocols, the same topics, managed as one mesh. Migrate workloads to the cloud at your own pace without rewriting a line of messaging code."
        />
        <div className="ff-grid">
          {FORM_FACTORS.map((f, i) => (
            <Reveal key={f.key} delay={i * 0.08}>
              <TiltCard>
                <div className="ff-icon"><Icon k={f.icon} /></div>
                <div className="ff-tag mono">{f.tag}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="hybrid panel">
            <div className="hy-col">
              <div className="hy-h mono">ON-PREM / COLO</div>
              {['Matching-engine colo', 'Primary DC', 'DR site'].map((x) => <div key={x} className="hy-box">{x}</div>)}
            </div>
            <div className="hy-mid">
              <svg viewBox="0 0 400 220" preserveAspectRatio="none">
                {[40, 110, 180].map((y, i) => [40, 110, 180].map((y2, j) => (
                  <path key={`${i}${j}`} d={`M0,${y} C200,${y} 200,${y2} 400,${y2}`} className="hy-link" style={{ animationDelay: `${(i + j) * 0.25}s` }} />
                )))}
              </svg>
              <div className="hy-core"><b>EVENT MESH</b><span className="mono">dynamic message routing</span></div>
            </div>
            <div className="hy-col">
              <div className="hy-h mono">PUBLIC CLOUD</div>
              {['AWS', 'Microsoft Azure', 'Google Cloud'].map((x) => <div key={x} className="hy-box cloud">{x}</div>)}
            </div>
          </div>
          <div className="protocols">
            <span className="mono">OPEN STANDARDS & APIs</span>
            <div className="proto-window">
              <div className="proto-track">
                {[...PROTOCOLS, ...PROTOCOLS].map((p, i) => <span key={i} className="proto">{p}</span>)}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
