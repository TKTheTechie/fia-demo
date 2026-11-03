import { useEffect, useRef, useState } from 'react'
import { broker } from '../lib/broker'
import { SectionHead, Reveal } from './Section'

type NodeDef = { id: string; label: string; sub: string; x: number; row: 'top' | 'bot'; color: string; icon: string }

const W = 1200, H = 520, BUS_Y = 260, TOP_Y = 56, BOT_Y = 464

const NODES: NodeDef[] = [
  { id: 'venue', label: 'Exchanges', sub: 'CME · NASDAQ · EBS', x: 100, row: 'top', color: 'var(--amber)', icon: '⬢' },
  { id: 'fh', label: 'Feed Handlers', sub: 'normalize · conflate', x: 300, row: 'top', color: 'var(--cyan)', icon: '≋' },
  { id: 'price', label: 'Pricing Engine', sub: 'curves · greeks', x: 500, row: 'top', color: 'var(--violet)', icon: 'ƒ' },
  { id: 'algo', label: 'Algo / SOR', sub: 'VWAP · POV · DMA', x: 700, row: 'top', color: 'var(--violet)', icon: '⟁' },
  { id: 'risk', label: 'Pre-Trade Risk', sub: 'limits · kill-switch', x: 900, row: 'top', color: 'var(--sell)', icon: '⛨' },
  { id: 'ui', label: 'Trader UIs', sub: 'web · desktop · mobile', x: 1100, row: 'top', color: 'var(--brand)', icon: '▣' },
  { id: 'oms', label: 'OMS', sub: 'orders · allocations', x: 100, row: 'bot', color: 'var(--brand)', icon: '☰' },
  { id: 'ems', label: 'EMS', sub: 'execution mgmt', x: 300, row: 'bot', color: 'var(--cyan)', icon: '⇄' },
  { id: 'fix', label: 'FIX Gateway', sub: 'venue connectivity', x: 500, row: 'bot', color: 'var(--amber)', icon: '⌁' },
  { id: 'post', label: 'Post-Trade', sub: 'clearing · settlement', x: 700, row: 'bot', color: 'var(--cyan)', icon: '✓' },
  { id: 'tca', label: 'Analytics / TCA', sub: 'data lake · AI', x: 900, row: 'bot', color: 'var(--violet)', icon: '◔' },
  { id: 'comp', label: 'Surveillance', sub: 'compliance · audit', x: 1100, row: 'bot', color: 'var(--muted)', icon: '◉' },
]
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))
const nodeY = (n: NodeDef) => (n.row === 'top' ? TOP_Y : BOT_Y)
const portY = (n: NodeDef) => (n.row === 'top' ? TOP_Y + 46 : BOT_Y - 46)

function hopPath(a: string, b: string) {
  const A = byId[a], B = byId[b]
  const ay = portY(A), by = portY(B)
  const busA = BUS_Y + (A.row === 'top' ? -10 : 10)
  const busB = BUS_Y + (B.row === 'top' ? -10 : 10)
  const r = 24
  const dir = B.x >= A.x ? 1 : -1
  if (A.x === B.x) return `M${A.x},${ay} L${A.x},${busA} L${B.x},${busB} L${B.x},${by}`
  return [
    `M${A.x},${ay}`,
    `L${A.x},${busA - (A.row === 'top' ? r : -r)}`,
    `Q${A.x},${busA} ${A.x + dir * r},${busA}`,
    `L${B.x - dir * r},${busB}`,
    `Q${B.x},${busB} ${B.x},${busB + (B.row === 'top' ? -r : r)}`,
    `L${B.x},${by}`,
  ].join(' ')
}

// topic subscription -> hops to animate
const ROUTES: { sub: string; hops: [string, string][]; color: string; sample: number }[] = [
  { sub: 'md/>', hops: [['fh', 'price'], ['fh', 'algo'], ['fh', 'ui'], ['fh', 'risk'], ['fh', 'tca']], color: 'var(--cyan)', sample: 0.35 },
  { sub: 'trade/oms/new/>', hops: [['oms', 'risk']], color: 'var(--brand)', sample: 1 },
  { sub: 'trade/risk/check/>', hops: [['risk', 'ems']], color: 'var(--amber)', sample: 1 },
  { sub: 'trade/risk/reject/>', hops: [['risk', 'oms'], ['risk', 'comp']], color: 'var(--sell)', sample: 1 },
  { sub: 'trade/ems/route/>', hops: [['ems', 'algo'], ['algo', 'fix']], color: 'var(--violet)', sample: 1 },
  { sub: 'trade/exec/fill/>', hops: [['fix', 'oms'], ['fix', 'ui'], ['fix', 'risk']], color: 'var(--buy)', sample: 1 },
  { sub: 'trade/post/clear/>', hops: [['oms', 'post'], ['oms', 'tca'], ['oms', 'comp']], color: 'var(--cyan)', sample: 1 },
]

type Particle = { path: SVGPathElement; len: number; t: number; dur: number; el: SVGCircleElement; tail: SVGCircleElement }

export default function Architecture() {
  const svgRef = useRef<SVGSVGElement>(null)
  const layer = useRef<SVGGElement>(null)
  const pathCache = useRef(new Map<string, SVGPathElement>())
  const [hot, setHot] = useState<Record<string, number>>({})
  const [log, setLog] = useState<{ id: number; topic: string; color: string }[]>([])
  const visible = useRef(true)

  useEffect(() => {
    const parts: Particle[] = []
    const ns = 'http://www.w3.org/2000/svg'
    let logId = 0
    const pending: { id: number; topic: string; color: string }[] = []
    const hits: Record<string, number> = {}

    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting))
    if (svgRef.current) io.observe(svgRef.current)

    const getPath = (a: string, b: string) => {
      const k = `${a}>${b}`
      let p = pathCache.current.get(k)
      if (!p) {
        p = document.createElementNS(ns, 'path')
        p.setAttribute('d', hopPath(a, b))
        pathCache.current.set(k, p)
      }
      return p
    }

    const spawn = (a: string, b: string, color: string, delay = 0) => {
      if (!layer.current || parts.length > 260) return
      const path = getPath(a, b)
      const tail = document.createElementNS(ns, 'circle')
      tail.setAttribute('r', '9'); tail.setAttribute('fill', color); tail.setAttribute('opacity', '0.18')
      const el = document.createElementNS(ns, 'circle')
      el.setAttribute('r', '4'); el.setAttribute('fill', color)
      el.setAttribute('filter', 'url(#glow)')
      layer.current.append(tail, el)
      parts.push({ path, len: path.getTotalLength(), t: -delay, dur: 900 + Math.random() * 300, el, tail })
      hits[a] = performance.now()
    }

    const unsubs = ROUTES.map((r) =>
      broker.subscribe(r.sub, (m) => {
        if (!visible.current || Math.random() > r.sample) return
        if (r.sub === 'md/>') spawn('venue', 'fh', 'var(--amber)')
        r.hops.forEach(([a, b], i) => spawn(a, b, r.color, r.sub === 'md/>' ? 500 : i * 120))
        if (r.sub !== 'md/>' || Math.random() < 0.25)
          pending.push({ id: logId++, topic: m.topic, color: r.color })
      }),
    )

    let last = performance.now(), raf = 0, lastUi = 0
    const tick = (now: number) => {
      const dt = now - last; last = now
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.t += dt
        if (p.t < 0) { p.el.setAttribute('opacity', '0'); p.tail.setAttribute('opacity', '0'); continue }
        const k = p.t / p.dur
        if (k >= 1) {
          p.el.remove(); p.tail.remove(); parts.splice(i, 1)
          continue
        }
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        const pt = p.path.getPointAtLength(e * p.len)
        p.el.setAttribute('cx', String(pt.x)); p.el.setAttribute('cy', String(pt.y)); p.el.setAttribute('opacity', '1')
        p.tail.setAttribute('cx', String(pt.x)); p.tail.setAttribute('cy', String(pt.y)); p.tail.setAttribute('opacity', '0.18')
      }
      if (now - lastUi > 150) {
        lastUi = now
        setHot({ ...hits })
        if (pending.length) {
          const add = pending.splice(0)
          setLog((l) => [...add.reverse(), ...l].slice(0, 16))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); unsubs.forEach((u) => u()); io.disconnect(); parts.forEach((p) => { p.el.remove(); p.tail.remove() }) }
  }, [])

  const now = performance.now()
  return (
    <section id="flow" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="01 · End-to-end"
          title={<>One mesh. <span className="grad">Every hop</span> of the trade lifecycle.</>}
          lede="From exchange feed to trader screen to clearing house — every component publishes and subscribes to topics on the Solace event mesh. No point-to-point spaghetti. Watch live order flow and market data move through the stack."
        />
        <Reveal delay={0.1}>
          <div className="arch panel">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="arch-svg" role="img" aria-label="Trading architecture on the Solace event mesh">
              <defs>
                <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <linearGradient id="busg" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--brand)" />
                  <stop offset="0.5" stopColor="var(--cyan)" />
                  <stop offset="1" stopColor="var(--violet)" />
                </linearGradient>
                <clipPath id="busclip"><rect x={30} y={BUS_Y - 34} width={W - 60} height={68} rx={34} /></clipPath>
                <pattern id="busstripe" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M0 24 L24 0" stroke="var(--brand)" strokeOpacity=".25" strokeWidth="2" />
                </pattern>
              </defs>

              {/* bus */}
              <g clipPath="url(#busclip)"><rect x={6} y={BUS_Y - 34} width={W - 12} height={68} fill="url(#busstripe)" className="bus-stripe" /></g>
              <rect x={30} y={BUS_Y - 34} width={W - 60} height={68} rx={34} fill="none" stroke="url(#busg)" strokeWidth="2" />
              <text x={W / 2} y={BUS_Y + 6} textAnchor="middle" className="bus-label">SOLACE EVENT MESH</text>
              <text x={60} y={BUS_Y + 5} className="bus-side">topic routed · guaranteed &amp; direct · fan-out</text>
              <text x={W - 60} y={BUS_Y + 5} textAnchor="end" className="bus-side">replay · ordering · ACLs</text>

              {/* stubs */}
              {NODES.map((n) => (
                <line key={n.id} x1={n.x} x2={n.x} y1={portY(n)} y2={n.row === 'top' ? BUS_Y - 34 : BUS_Y + 34} className="stub" />
              ))}
              <path d={`M100,${TOP_Y + 46} C100,${TOP_Y + 90} 300,${TOP_Y + 90} 300,${TOP_Y + 46}`} className="stub" />

              <g ref={layer} />

              {NODES.map((n) => {
                const glow = hot[n.id] && now - hot[n.id] < 300
                return (
                  <g key={n.id} transform={`translate(${n.x},${nodeY(n)})`} className={`arch-node ${glow ? 'hot' : ''}`}>
                    <rect x={-84} y={-46} width={168} height={92} rx={16} className="node-box" style={{ ['--c' as string]: n.color }} />
                    <text y={-10} textAnchor="middle" className="node-icon" fill={n.color}>{n.icon}</text>
                    <text y={16} textAnchor="middle" className="node-label">{n.label}</text>
                    <text y={33} textAnchor="middle" className="node-sub">{n.sub}</text>
                  </g>
                )
              })}
            </svg>
            <div className="arch-log mono">
              <div className="arch-log-h">LIVE TOPICS</div>
              {log.map((l) => (
                <div key={l.id} className="arch-log-row" style={{ color: l.color }}>
                  {l.topic.split('/').map((s, i, a) => (
                    <span key={i}>{s}{i < a.length - 1 && <i>/</i>}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
