import { geoDistance, geoGraticule10, geoInterpolate, geoNaturalEarth1, geoPath } from 'd3-geo'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import land110 from 'world-atlas/land-110m.json'
import { topicMatches } from '../lib/broker'
import { fmt } from '../lib/format'
import { isPaused, scaled } from '../lib/pause'
import { useScenario } from '../lib/scenario'
import { KRec, makeRecord, pick, pickTopic } from '../lib/sim/records'
import type { Scenario } from '../scenarios/types'
import { ScenarioHead, Reveal } from './Section'

// Global version of the Kafka bridge story.
// Regional Kafka clusters (Chicago, New Jersey, London) carry flat market-data
// topics; each is bridged into its local Solace broker as hierarchical topics.
// Trader blotters around the world subscribe to precise slices, and the mesh
// forwards an event over a WAN link only if someone downstream asked for it.
// Every dot on the map is one event heading to one desk; it lands in that
// desk's blotter when it arrives.

type Row = KRec & { src: string; ms: number; rk: number }

const ROWS = 5

// The kafka.ui chips (max 5) are coloured by position; the classes keep their original names.
const CHIP_CLS = ['a-eq', 'a-fut', 'a-fx', 'a-rt', 'a-cx']

const W = 1200, H = 600
const linkId = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)

// shortest hop path over the mesh links
function route(LINKS: [string, string][], from: string, to: string): string[] {
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
function fibreMs(hubById: Record<string, { lon: number; lat: number }>, path: string[]) {
  let km = 0
  for (let i = 1; i < path.length; i++) {
    const a = hubById[path[i - 1]], b = hubById[path[i]]
    km += geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371
  }
  return Math.max(0.05, (km * 1.3) / 200)
}

export default function GlobalBlotters() {
  const sc = useScenario()
  const { hubs: HUBS, links: LINKS, ingest: INGEST } = sc.sites
  const hubById = useMemo(() => Object.fromEntries(HUBS.map((h) => [h.id, h])), [HUBS])
  const INGEST_HUBS = useMemo(() => [...new Set(Object.values(INGEST))], [INGEST])
  const BADGE = sc.sites.kafkaBadge ?? {}
  const DESKS = useMemo(() => sc.personas.map((p) => ({ id: p.id, hub: p.site, city: p.city, desk: p.role, subs: p.subs })), [sc])
  const chipOf = (r: KRec) => Math.max(0, sc.kafka.ui.chips.findIndex((c) => c.id === r.headers[sc.kafka.ui.chipHeader]))
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
  }, [proj, LINKS, hubById])

  // precomputed routes from every ingest hub to every desk
  const routes = useMemo(() => {
    const m = new Map<string, { hops: string[]; links: string[]; pts: [number, number][]; cum: number[]; ms: number }>()
    for (const s of INGEST_HUBS) for (const d of DESKS) {
      const hops = route(LINKS, s, d.hub)
      const pts: [number, number][] = []
      const links: string[] = []
      for (let i = 1; i < hops.length; i++) {
        links.push(linkId(hops[i - 1], hops[i]))
        const seg = arcs.get(`${hops[i - 1]}-${hops[i]}`)!
        pts.push(...(i === 1 ? seg : seg.slice(1)))
      }
      const cum = [0]
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
      m.set(`${s}>${d.id}`, { hops, links, pts, cum, ms: fibreMs(hubById, hops) })
    }
    return m
  }, [arcs, LINKS, DESKS, INGEST_HUBS, hubById])

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
      if (isPaused()) { timer = window.setTimeout(produce, 200); return }
      const n = 2 + Math.floor(Math.random() * 2)
      for (let k = 0; k < n; k++) {
        const { topic: kt, index } = pickTopic(sc)
        const base = makeRecord(sc, pick(sc.model.entities), kt, index, id++)
        const ev: Row = { ...base, src: INGEST[base.origin], ms: 0, rk: 0 }
        counts.current.ingested++
        counts.current.flood += HUBS.length - 1 // naive replication: every event to every site
        const used = new Set<string>()
        DESKS.forEach((d, di) => {
          if (!topicMatches(subsRef.current[di], ev.solaceTopic)) return
          const r = routes.get(`${ev.src}>${d.id}`)!
          r.links.forEach((l) => used.add(l))
          const row: Row = { ...ev, ms: r.ms, rk: key++ }
          const local = r.pts.length === 0
          let el: SVGCircleElement | null = null
          if (!local && layer.current && dots.length < 90) {
            el = document.createElementNS(ns, 'circle')
            el.setAttribute('r', '3.4')
            el.setAttribute('class', `gd-dot ${CHIP_CLS[chipOf(ev)]}${focusRef.current && focusRef.current !== d.id ? ' dim' : ''}`)
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
      timer = window.setTimeout(produce, scaled(380 + Math.random() * 320))
    }

    const tick = (now: number) => {
      const dt = isPaused() ? 0 : Math.min(64, now - last); last = now
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i]
        d.t += dt
        const k = d.t / d.dur
        if (k >= 1) {
          d.el?.remove(); dots.splice(i, 1)
          counts.current.delivered++
          deskBuf.current[d.desk] = [{ ...d.row }, ...deskBuf.current[d.desk]].slice(0, ROWS)
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
  }, [inView, routes, sc, DESKS, HUBS, INGEST])

  const focusLinks = useMemo(() => {
    if (!focus) return null
    const s = new Set<string>()
    INGEST_HUBS.forEach((h) => routes.get(`${h}>${focus}`)!.links.forEach((l) => s.add(l)))
    return s
  }, [focus, routes, INGEST_HUBS])

  return (
    <section id="global" className="fit" ref={sectionRef}>
      <div className="wrap">
        <ScenarioHead id="global" split />
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
                          <g transform={`translate(${(BADGE[h.id] ?? [-8, -28])[0]},${(BADGE[h.id] ?? [-8, -28])[1]})`} className="gd-kafka">
                            <rect width="16" height="16" rx="4" /><text x="8" y="12">K</text>
                          </g>
                        )}
                        {desk && (
                          <>
                            <text x={lx} y={ly} textAnchor={right ? 'start' : 'end'} className="wan-name">{desk.city}</text>
                            <text x={lx} y={ly + 14} textAnchor={right ? 'start' : 'end'} className="wan-dc">{sc.consumerNoun ? `${desk.desk} ${sc.consumerNoun}` : desk.desk}</text>
                          </>
                        )}
                      </g>
                    )
                  })}
                </svg>
                <div className="gd-legend mono">
                  {sc.kafka.ui.chips.map((c, i) => <span key={c.id}><i className={CHIP_CLS[i]} />{c.label}</span>)}
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
                        <motion.div key={r.rk} layout initial={{ opacity: 0, y: -10, backgroundColor: 'rgba(42,183,255,0.2)' }}
                          animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.8 }} className="gd-row">
                          <span className={`gd-tag ${CHIP_CLS[chipOf(r)]}`}>{r.kind[0].toUpperCase()}</span>
                          <b>{r.entityId}</b>
                          <span className="gd-px">{headline(sc, r)}</span>
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

/** One compact figure for a desk row, following the Kafka topic's `render`. */
function headline(sc: Scenario, r: KRec) {
  const render = sc.kafka.topics[r.kindIndex].render ?? 'value'
  if (render === 'bidask') return fmt(r.bid, r.dp)
  if (render === 'delta') return `${r.delta >= 0 ? '+' : '−'}${Math.abs(r.delta).toLocaleString()}`
  return fmt(r.value, r.dp)
}
