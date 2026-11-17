import { geoDistance, geoGraticule10, geoInterpolate, geoNaturalEarth1, geoPath } from 'd3-geo'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import land110 from 'world-atlas/land-110m.json'
import { topicMatches } from '../lib/broker'
import { HUBS, LINKS } from '../lib/hubs'
import { INSTRUMENTS, Instrument, fmt } from '../lib/market'
import { SectionHead, Reveal } from './Section'

// Global version of the Kafka bridge story.
// Regional Kafka clusters (Chicago, New Jersey, London) carry flat market-data
// topics; each is bridged into its local Solace broker as hierarchical topics.
// Trader blotters around the world subscribe to precise slices, and the mesh
// forwards an event over a WAN link only if someone downstream asked for it.
// Every dot on the map is one event heading to one desk; it lands in that
// desk's blotter when it arrives.

type Kind = 'quote' | 'trade'
type Ev = { id: number; sym: string; asset: Instrument['asset']; venue: string; kind: Kind; px: number; bid: number; ask: number; dp: number; topic: string; src: string }
type Row = Ev & { ms: number; key: number }

// Market venue → hub whose Kafka cluster ingests it
const INGEST: Record<string, string> = { CME: 'CHI', CBOT: 'CHI', NYMEX: 'NY4', COMEX: 'NY4', NASDAQ: 'NY4', NYSE: 'NY4', EBS: 'LD4', LSEG: 'LD4' }
const INGEST_HUBS = ['CHI', 'NY4', 'LD4']
const BADGE: Record<string, [number, number]> = { CHI: [-34, -8], NY4: [-8, 12], LD4: [10, -28] }

const DESKS = [
  { id: 'nyc', hub: 'NY4', city: 'New York', desk: 'Equities', subs: ['md/equities/>', 'md/equities/NASDAQ/>', 'md/*/*/NVDA/>'] },
  { id: 'chi', hub: 'CHI', city: 'Chicago', desk: 'Futures', subs: ['md/futures/CME/>', 'md/futures/>', 'md/*/CME/*/trade'] },
  { id: 'ldn', hub: 'LD4', city: 'London', desk: 'FX spot', subs: ['md/fx/>', 'md/fx/*/GBPUSD/>', 'md/fx/*/*/trade'] },
  { id: 'fra', hub: 'FR2', city: 'Frankfurt', desk: 'Rates', subs: ['md/rates/>', 'md/rates/*/ZN/quote', 'md/futures/COMEX/GC/>'] },
  { id: 'sgp', hub: 'SG1', city: 'Singapore', desk: 'Macro', subs: ['md/*/*/*/trade', 'md/futures/*/CL/>', 'md/crypto/>'] },
  { id: 'tyo', hub: 'TY3', city: 'Tokyo', desk: 'JPY & index', subs: ['md/fx/*/USDJPY/>', 'md/futures/CME/NQ/>', 'md/*/*/USD*/>'] },
]
const ROWS = 5

const ASSET_CLS: Record<Instrument['asset'], string> = { equities: 'a-eq', futures: 'a-fut', fx: 'a-fx', rates: 'a-rt', crypto: 'a-cx' }

const W = 1200, H = 600
const hubById = Object.fromEntries(HUBS.map((h) => [h.id, h]))
const linkId = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)

// shortest hop path over the mesh links
function route(from: string, to: string): string[] {
  const prev = new Map<string, string>([[from, '']])
  const q = [from]
  while (q.length) {
    const u = q.shift()!
    if (u === to) break
    for (const [a, b] of LINKS) {
      const v = a === u ? b : b === u ? a : null
      if (v && !prev.has(v)) { prev.set(v, u); q.push(v) }
    }
  }
  const out = [to]
  while (out[0] !== from) out.unshift(prev.get(out[0])!)
  return out
}

// one-way fibre latency along the route (~200 km per ms, x1.3 for real-world paths)
function fibreMs(path: string[]) {
  let km = 0
  for (let i = 1; i < path.length; i++) {
    const a = hubById[path[i - 1]], b = hubById[path[i]]
    km += geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371
  }
  return Math.max(0.05, (km * 1.3) / 200)
}

export default function GlobalBlotters() {
  const sectionRef = useRef<HTMLElement>(null)
  const inView = useInView(sectionRef, { margin: '-80px' })

  const proj = useMemo(() => geoNaturalEarth1().scale(205).translate([W / 2 - 10, H / 2 + 5]), [])
  const path = useMemo(() => geoPath(proj), [proj])
  const landD = useMemo(() => {
    const topo = land110 as unknown as Topology<{ land: GeometryCollection }>
    return path(feature(topo, topo.objects.land)) || ''
  }, [path])
  const gratD = useMemo(() => path(geoGraticule10()) || '', [path])

  // arc polylines keyed by "A-B" in the A→B direction
  const arcs = useMemo(() => {
    const m = new Map<string, [number, number][]>()
    for (const [a, b] of LINKS) {
      const A = hubById[a], B = hubById[b]
      const interp = geoInterpolate([A.lon, A.lat], [B.lon, B.lat])
      const pts = Array.from({ length: 48 }, (_, i) => proj(interp(i / 47)) as [number, number])
      const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1]
      const lift = Math.hypot(x1 - x0, y1 - y0) * 0.18
      const lifted = pts.map(([x, y], i) => [x, y - Math.sin((i / 47) * Math.PI) * lift] as [number, number])
      m.set(`${a}-${b}`, lifted)
      m.set(`${b}-${a}`, [...lifted].reverse())
    }
    return m
  }, [proj])

  // precomputed routes from every ingest hub to every desk
  const routes = useMemo(() => {
    const m = new Map<string, { hops: string[]; links: string[]; pts: [number, number][]; cum: number[]; ms: number }>()
    for (const s of INGEST_HUBS) for (const d of DESKS) {
      const hops = route(s, d.hub)
      const pts: [number, number][] = []
      const links: string[] = []
      for (let i = 1; i < hops.length; i++) {
        links.push(linkId(hops[i - 1], hops[i]))
        const seg = arcs.get(`${hops[i - 1]}-${hops[i]}`)!
        pts.push(...(i === 1 ? seg : seg.slice(1)))
      }
      const cum = [0]
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
      m.set(`${s}>${d.id}`, { hops, links, pts, cum, ms: fibreMs(hops) })
    }
    return m
  }, [arcs])

  const [subIdx, setSubIdx] = useState<number[]>(() => DESKS.map(() => 0))
  const subsRef = useRef<string[]>([])
  subsRef.current = DESKS.map((d, i) => d.subs[subIdx[i]])
  const [focus, setFocus] = useState<string | null>(null)
  const focusRef = useRef(focus)
  focusRef.current = focus

  const [rows, setRows] = useState<Record<string, Row[]>>(() => Object.fromEntries(DESKS.map((d) => [d.id, []])))
  const [hot, setHot] = useState<Set<string>>(new Set())
  const [stats, setStats] = useState({ ingested: 0, delivered: 0, saved: 0 })
  const deskBuf = useRef<Record<string, Row[]>>(Object.fromEntries(DESKS.map((d) => [d.id, []])))
  const linkSeen = useRef(new Map<string, number>())
  const counts = useRef({ ingested: 0, delivered: 0, hops: 0, flood: 0 })
  const layer = useRef<SVGGElement>(null)

  // reset a desk's blotter when its subscription changes
  const cycleSub = (i: number) => {
    setSubIdx((s) => s.map((v, j) => (j === i ? (v + 1) % DESKS[i].subs.length : v)))
    deskBuf.current[DESKS[i].id] = []
    setRows((r) => ({ ...r, [DESKS[i].id]: [] }))
  }

  useEffect(() => {
    if (!inView) return
    const ns = 'http://www.w3.org/2000/svg'
    type Dot = { el: SVGCircleElement | null; r: { pts: [number, number][]; cum: number[] } | null; t: number; dur: number; row: Row; desk: string; seg: number }
    const dots: Dot[] = []
    let id = 0, key = 0, raf = 0, timer = 0, last = performance.now()

    const produce = () => {
      const n = 2 + Math.floor(Math.random() * 2)
      for (let k = 0; k < n; k++) {
        const i = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)]
        const kind: Kind = Math.random() < 0.6 ? 'quote' : 'trade'
        const px = i.px * (1 + (Math.random() - 0.5) * i.vol)
        const spread = px * 0.00005 + Math.pow(10, -i.dp)
        const ev: Ev = {
          id: id++, sym: i.sym, asset: i.asset, venue: i.venue, kind, px, bid: px - spread / 2, ask: px + spread / 2, dp: i.dp,
          topic: `md/${i.asset}/${i.venue}/${i.sym}/${kind}`, src: INGEST[i.venue],
        }
        counts.current.ingested++
        counts.current.flood += HUBS.length - 1 // naive replication: every event to every site
        const used = new Set<string>()
        DESKS.forEach((d, di) => {
          if (!topicMatches(subsRef.current[di], ev.topic)) return
          const r = routes.get(`${ev.src}>${d.id}`)!
          r.links.forEach((l) => used.add(l))
          const row: Row = { ...ev, ms: r.ms, key: key++ }
          const local = r.pts.length === 0
          let el: SVGCircleElement | null = null
          if (!local && layer.current && dots.length < 90) {
            el = document.createElementNS(ns, 'circle')
            el.setAttribute('r', '3.4')
            el.setAttribute('class', `gd-dot ${ASSET_CLS[ev.asset]}${focusRef.current && focusRef.current !== d.id ? ' dim' : ''}`)
            el.setAttribute('cx', String(r.pts[0][0])); el.setAttribute('cy', String(r.pts[0][1]))
            layer.current.appendChild(el)
          }
          const len = local ? 0 : r.cum[r.cum.length - 1]
          dots.push({ el, r: local ? null : r, t: 0, dur: local ? 350 : 1400 + len * 3.2, row, desk: d.id, seg: 0 })
        })
        const now = performance.now()
        used.forEach((l) => linkSeen.current.set(l, now))
        counts.current.hops += used.size
      }
      timer = window.setTimeout(produce, 380 + Math.random() * 320)
    }

    const tick = (now: number) => {
      const dt = Math.min(64, now - last); last = now
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i]
        d.t += dt
        const k = d.t / d.dur
        if (k >= 1) {
          d.el?.remove(); dots.splice(i, 1)
          counts.current.delivered++
          deskBuf.current[d.desk] = [{ ...d.row, key: d.row.key }, ...deskBuf.current[d.desk]].slice(0, ROWS)
          continue
        }
        if (d.el && d.r) {
          const target = (1 - Math.pow(1 - k, 1.6)) * d.r.cum[d.r.cum.length - 1]
          while (d.seg < d.r.cum.length - 2 && d.r.cum[d.seg + 1] < target) d.seg++
          const a = d.r.pts[d.seg], b = d.r.pts[d.seg + 1]
          const span = d.r.cum[d.seg + 1] - d.r.cum[d.seg] || 1
          const f = (target - d.r.cum[d.seg]) / span
          d.el.setAttribute('cx', (a[0] + (b[0] - a[0]) * f).toFixed(1))
          d.el.setAttribute('cy', (a[1] + (b[1] - a[1]) * f).toFixed(1))
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const ui = setInterval(() => {
      setRows({ ...deskBuf.current })
      const now = performance.now()
      setHot(new Set([...linkSeen.current].filter(([, t]) => now - t < 2500).map(([l]) => l)))
      const c = counts.current
      setStats({ ingested: c.ingested, delivered: c.delivered, saved: c.flood ? (1 - c.hops / c.flood) * 100 : 0 })
    }, 600)

    produce()
    raf = requestAnimationFrame(tick)
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); clearInterval(ui); dots.forEach((d) => d.el?.remove()) }
  }, [inView, routes])

  const focusLinks = useMemo(() => {
    if (!focus) return null
    const s = new Set<string>()
    INGEST_HUBS.forEach((h) => routes.get(`${h}>${focus}`)!.links.forEach((l) => s.add(l)))
    return s
  }, [focus, routes])

  return (
    <section id="global" className="fit" ref={sectionRef}>
      <div className="wrap">
        <SectionHead
          split
          eyebrow="08 · Global distribution"
          title={<>Every desk, every region, <span className="grad">its own stream</span>.</>}
          lede="Regional Kafka clusters feed the mesh through the Kafka bridge. Blotters in New York, London, Frankfurt, Singapore and Tokyo each subscribe to exactly what they trade — and the mesh only sends an event across a WAN link when someone on the far side asked for it. Tap a desk's subscription to change it."
        />
        <Reveal delay={0.1}>
          <div className="gd-grid">
            <div className="gd-left">
              <div className="panel gd-map">
                <svg viewBox={`0 0 ${W} ${H}`} className="gd-svg">
                  <path d={gratD} className="wan-grat" />
                  <path d={landD} className="wan-land" />
                  {LINKS.map(([a, b]) => {
                    const l = linkId(a, b)
                    const on = focusLinks ? focusLinks.has(l) : hot.has(l)
                    return <polyline key={l} points={arcs.get(`${a}-${b}`)!.map((p) => p.join(',')).join(' ')} className={`gd-arc ${on ? 'hot' : ''}`} />
                  })}
                  <g ref={layer} className="gd-layer" />
                  {HUBS.map((h) => {
                    const [x, y] = proj([h.lon, h.lat])!
                    const desk = DESKS.find((d) => d.hub === h.id)
                    const ingest = INGEST_HUBS.includes(h.id)
                    const pos = h.label ?? 'r'
                    const right = pos === 'r' || pos === 'br'
                    const lx = right ? 14 : -14
                    const ly = pos === 'bl' || pos === 'br' ? 24 : pos === 'tl' ? -20 : -12
                    const dim = focus && desk?.id !== focus && !ingest
                    return (
                      <g key={h.id} transform={`translate(${x},${y})`}
                        className={`gd-hub ${desk ? 'desk' : 'relay'} ${focus && desk?.id === focus ? 'focus' : ''} ${dim ? 'dim' : ''}`}
                        onMouseEnter={() => desk && setFocus(desk.id)} onMouseLeave={() => setFocus(null)}>
                        {desk && <circle r="16" className="wan-ring" />}
                        <circle r={desk ? 6.5 : 4} className="gd-core" />
                        {ingest && (
                          <g transform={`translate(${BADGE[h.id][0]},${BADGE[h.id][1]})`} className="gd-kafka">
                            <rect width="16" height="16" rx="4" /><text x="8" y="12">K</text>
                          </g>
                        )}
                        {desk && (
                          <>
                            <text x={lx} y={ly} textAnchor={right ? 'start' : 'end'} className="wan-name">{desk.city}</text>
                            <text x={lx} y={ly + 14} textAnchor={right ? 'start' : 'end'} className="wan-dc">{desk.desk} desk</text>
                          </>
                        )}
                      </g>
                    )
                  })}
                </svg>
                <div className="gd-legend mono">
                  <span><i className="a-eq" />Equities</span><span><i className="a-fut" />Futures</span><span><i className="a-fx" />FX</span>
                  <span><i className="a-rt" />Rates</span><span><i className="a-cx" />Crypto</span>
                  <span className="gd-k"><b>K</b>Kafka + bridge</span>
                </div>
              </div>
              <div className="gd-stats mono">
                <div><b>{stats.ingested.toLocaleString()}</b><span>events from Kafka</span></div>
                <div><b className="up">{stats.delivered.toLocaleString()}</b><span>delivered to desks</span></div>
                <div><b>{stats.saved.toFixed(0)}%</b><span>WAN traffic avoided</span></div>
              </div>
              <p className="footnote">Illustrative. "WAN traffic avoided" compares link hops used against copying every event to every site. Latency shown is estimated one-way fibre time.</p>
            </div>

            <div className="gd-desks">
              {DESKS.map((d, i) => (
                <div key={d.id} className={`panel gd-desk ${focus === d.id ? 'focus' : ''}`}
                  onMouseEnter={() => setFocus(d.id)} onMouseLeave={() => setFocus(null)}>
                  <div className="gd-dh">
                    <span className="live" />
                    <b>{d.city}</b><span className="muted">{d.desk}</span>
                    <em className="mono">{d.hub}</em>
                  </div>
                  <button className="gd-sub mono" onClick={() => cycleSub(i)} title="Tap to change this desk's subscription">
                    <span>{d.subs[subIdx[i]]}</span><i>⟳</i>
                  </button>
                  <div className="gd-rows mono">
                    <AnimatePresence initial={false} mode="popLayout">
                      {rows[d.id].map((r) => (
                        <motion.div key={r.key} layout initial={{ opacity: 0, y: -10, backgroundColor: 'rgba(42,183,255,0.2)' }}
                          animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.8 }} className="gd-row">
                          <span className={`gd-tag ${ASSET_CLS[r.asset]}`}>{r.kind === 'trade' ? 'T' : 'Q'}</span>
                          <b>{r.sym}</b>
                          <span className="gd-px">{r.kind === 'trade' ? fmt(r.px, r.dp) : fmt(r.bid, r.dp)}</span>
                          <span className="muted gd-lat">{r.src === d.hub ? 'local' : `${r.src} ${r.ms.toFixed(0)}ms`}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {!rows[d.id].length && <div className="gd-empty muted">subscribed · waiting…</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
