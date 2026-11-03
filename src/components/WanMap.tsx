import { geoNaturalEarth1, geoPath, geoInterpolate, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import land110 from 'world-atlas/land-110m.json'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionHead, Reveal } from './Section'

type Hub = { id: string; name: string; dc: string; lon: number; lat: number; kind: 'colo' | 'cloud' | 'dc'; label?: 'l' | 'r' | 'bl' | 'br' | 'tl' }

const HUBS: Hub[] = [
  { id: 'CHI', name: 'Chicago', dc: 'Aurora · CME colo', lon: -88.3, lat: 41.76, kind: 'colo', label: 'tl' },
  { id: 'NY4', name: 'New Jersey', dc: 'Secaucus · NY4', lon: -74.06, lat: 40.79, kind: 'colo', label: 'r' },
  { id: 'USE', name: 'N. Virginia', dc: 'AWS us-east-1', lon: -77.5, lat: 39.0, kind: 'cloud', label: 'bl' },
  { id: 'LD4', name: 'London', dc: 'Slough · LD4', lon: -0.6, lat: 51.5, kind: 'colo', label: 'l' },
  { id: 'FR2', name: 'Frankfurt', dc: 'Eurex · FR2', lon: 8.68, lat: 50.11, kind: 'colo' },
  { id: 'SG1', name: 'Singapore', dc: 'SGX · SG1', lon: 103.85, lat: 1.29, kind: 'colo' },
  { id: 'TY3', name: 'Tokyo', dc: 'JPX · TY3', lon: 139.69, lat: 35.68, kind: 'colo' },
  { id: 'HK1', name: 'Hong Kong', dc: 'HKEX', lon: 114.17, lat: 22.32, kind: 'dc', label: 'br' },
  { id: 'SYD', name: 'Sydney', dc: 'Azure australiaeast', lon: 151.2, lat: -33.86, kind: 'cloud' },
  { id: 'SAO', name: 'São Paulo', dc: 'B3', lon: -46.63, lat: -23.55, kind: 'dc' },
  { id: 'MUM', name: 'Mumbai', dc: 'GCP asia-south1', lon: 72.88, lat: 19.07, kind: 'cloud', label: 'l' },
]
const LINKS: [string, string][] = [
  ['CHI', 'NY4'], ['NY4', 'USE'], ['NY4', 'LD4'], ['CHI', 'LD4'], ['LD4', 'FR2'], ['LD4', 'SG1'], ['FR2', 'MUM'],
  ['MUM', 'SG1'], ['SG1', 'HK1'], ['HK1', 'TY3'], ['HK1', 'LD4'], ['SG1', 'SYD'], ['NY4', 'SAO'], ['TY3', 'SYD'], ['USE', 'SAO'],
]

const W = 1200, H = 600

export default function WanMap() {
  const proj = useMemo(() => geoNaturalEarth1().scale(205).translate([W / 2 - 10, H / 2 + 5]), [])
  const path = useMemo(() => geoPath(proj), [proj])
  const landD = useMemo(() => {
    const topo = land110 as unknown as Topology<{ land: GeometryCollection }>
    return path(feature(topo, topo.objects.land)) || ''
  }, [path])
  const gratD = useMemo(() => path(geoGraticule10()) || '', [path])
  const hub = useMemo(() => Object.fromEntries(HUBS.map((h) => [h.id, h])), [])
  const pt = (h: Hub) => proj([h.lon, h.lat])!
  const arcs = useMemo(
    () => LINKS.map(([a, b]) => {
      const A = hub[a], B = hub[b]
      const interp = geoInterpolate([A.lon, A.lat], [B.lon, B.lat])
      const pts = Array.from({ length: 48 }, (_, i) => proj(interp(i / 47))!)
      // lift arcs for visual separation
      const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1]
      const lift = Math.hypot(x1 - x0, y1 - y0) * 0.18
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${(y - Math.sin((i / 47) * Math.PI) * lift).toFixed(1)}`).join('')
      return { id: `${a}-${b}`, a, b, d }
    }),
    [hub, proj],
  )

  const [failed, setFailed] = useState<string | null>(null)
  const [stats, setStats] = useState({ msgs: 0 })
  const layer = useRef<SVGGElement>(null)
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({})
  const failedRef = useRef(failed)
  failedRef.current = failed

  useEffect(() => {
    const ns = 'http://www.w3.org/2000/svg'
    type P = { el: SVGCircleElement; p: SVGPathElement; len: number; t: number; dur: number; rev: boolean }
    const ps: P[] = []
    let raf = 0, last = performance.now(), acc = 0, msgs = 0, lastUi = 0
    const tick = (now: number) => {
      const dt = now - last; last = now; acc += dt
      while (acc > 70) {
        acc -= 70
        const live = arcs.filter((a) => a.a !== failedRef.current && a.b !== failedRef.current)
        const a = live[Math.floor(Math.random() * live.length)]
        const p = pathRefs.current[a.id]
        if (p && layer.current && ps.length < 120) {
          const el = document.createElementNS(ns, 'circle')
          el.setAttribute('r', '3.2')
          el.setAttribute('class', 'wan-dot')
          layer.current.appendChild(el)
          ps.push({ el, p, len: p.getTotalLength(), t: 0, dur: 1400 + Math.random() * 1200, rev: Math.random() > 0.5 })
        }
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const q = ps[i]; q.t += dt
        const k = q.t / q.dur
        if (k >= 1) { q.el.remove(); ps.splice(i, 1); msgs += 1; continue }
        const pt = q.p.getPointAtLength((q.rev ? 1 - k : k) * q.len)
        q.el.setAttribute('cx', String(pt.x)); q.el.setAttribute('cy', String(pt.y))
      }
      if (now - lastUi > 250) { lastUi = now; setStats({ msgs }) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ps.forEach((q) => q.el.remove()) }
  }, [arcs])

  return (
    <section id="wan" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="04 · WAN routing"
          title={<>Chicago to Tokyo, <span className="grad">one namespace</span>.</>}
          lede="Brokers in every colo, data center and cloud region link into a single event mesh. Subscriptions propagate automatically, so an app in Singapore subscribes to CME data exactly as it would in Aurora — and the mesh only sends across the WAN what someone actually asked for. Click a hub to simulate an outage."
        />
        <Reveal delay={0.1}>
          <div className="panel wan">
            <svg viewBox={`0 0 ${W} ${H}`} className="wan-svg">
              <path d={gratD} className="wan-grat" />
              <path d={landD} className="wan-land" />
              {arcs.map((a) => {
                const down = a.a === failed || a.b === failed
                return <path key={a.id} ref={(el) => (pathRefs.current[a.id] = el)} d={a.d} className={`wan-arc ${down ? 'down' : ''}`} />
              })}
              <g ref={layer} />
              {HUBS.map((h) => {
                const [x, y] = pt(h)
                const down = failed === h.id
                const pos = h.label ?? 'r'
                const right = pos === 'r' || pos === 'br'
                const lx = right ? 14 : -14
                const ly = pos === 'bl' || pos === 'br' ? 24 : pos === 'tl' ? -20 : -12
                return (
                  <g key={h.id} transform={`translate(${x},${y})`} className={`wan-hub ${h.kind} ${down ? 'down' : ''}`}
                    onClick={() => setFailed((f) => (f === h.id ? null : h.id))}>
                    <circle r="18" className="wan-ring" />
                    <circle r="7" className="wan-core" />
                    <text x={lx} y={ly} textAnchor={right ? 'start' : 'end'} className="wan-name">{h.name}</text>
                    <text x={lx} y={ly + 14} textAnchor={right ? 'start' : 'end'} className="wan-dc">{down ? 'OFFLINE · rerouting' : h.dc}</text>
                  </g>
                )
              })}
            </svg>
            <div className="wan-hud mono">
              <div><b>{HUBS.length - (failed ? 1 : 0)}</b><span>brokers online</span></div>
              <div><b>{stats.msgs.toLocaleString()}</b><span>events across WAN</span></div>
              <div><b className={failed ? 'dn' : 'up'}>{failed ? 'DEGRADED' : 'HEALTHY'}</b><span>{failed ? 'mesh re-routes via peers' : 'all links active'}</span></div>
              <div className="wan-legend"><i className="colo" />Colo <i className="cloud" />Cloud <i className="dc" />Data center</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
