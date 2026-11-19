import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { broker } from '../lib/broker'
import { fmt } from '../lib/format'
import { useScenario } from '../lib/scenario'
import { Item, facetSubscription, lifecycleRoot } from '../lib/sim/lifecycle'
import { feedSubscription, feedTopic, type Tick } from '../lib/sim/stream'
import type { Column, ColumnFormat, Scenario } from '../scenarios/types'
import { Reveal, ScenarioHead } from './Section'

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <svg className="spark" />
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${(i / (data.length - 1)) * 100},${28 - ((v - min) / r) * 26}`).join('')
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d={`${d} L100,30 L0,30 Z`} className={up ? 'sp-fill up' : 'sp-fill dn'} />
      <path d={d} className={up ? 'sp-line up' : 'sp-line dn'} />
    </svg>
  )
}

type Q = Tick & { dir: 0 | 1 | -1; hist: number[]; n: number; restockedAt: number }

function Watch() {
  const sc = useScenario()
  const { entities } = sc.model
  const two = sc.watch.columns.length > 1
  const [q, setQ] = useState<Record<string, Q>>({})
  const buf = useRef<Record<string, Q>>({})
  useEffect(() => {
    buf.current = {}
    const uns = entities.map((e) => broker.subscribe<Tick>(feedTopic(sc, e.id), (m) => {
      const prev = buf.current[e.id]
      const hist = prev ? [...prev.hist, m.payload.last].slice(-40) : [m.payload.last]
      const restocked = prev && e.value.sawtooth && m.payload.last - prev.last > e.value.start * 0.3
      buf.current[e.id] = { ...m.payload, dir: prev ? (m.payload.last > prev.last ? 1 : m.payload.last < prev.last ? -1 : 0) : 0, hist, n: (prev?.n ?? 0) + 1, restockedAt: restocked ? Date.now() : (prev?.restockedAt ?? 0) }
    }))
    const iv = setInterval(() => setQ({ ...buf.current }), 200)
    return () => { uns.forEach((u) => u()); clearInterval(iv) }
  }, [sc, entities])
  const lv = sc.watch.level
  return (
    <div className="panel mw">
      <div className="bl-h"><span className="live" />{sc.watch.title} <em className="mono">{feedSubscription(sc)}</em></div>
      <table className="mono">
        <thead>
          <tr>
            <th>{sc.kafka.ui.idLabel}</th>{sc.watch.columns.map((c) => <th key={c}>{c}</th>)}
            {lv ? <><th className="hide-s">LEVEL</th><th>STATUS</th></> : <th>CHG</th>}
            <th className="hide-s">TREND</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => {
            const x = q[e.id]
            const cols = sc.watch.columns.length + (lv ? 2 : 1) + 1
            if (!x) return <tr key={e.id}><td>{e.id}</td><td colSpan={cols}>—</td></tr>
            const cls = x.dir > 0 ? 'flash-up' : x.dir < 0 ? 'flash-dn' : ''
            const dp = e.value.decimals
            const ratio = x.last / e.value.start
            const state = !lv ? 'ok' : ratio < lv.critical ? 'critical' : ratio < lv.low ? 'low' : 'ok'
            const fresh = lv && Date.now() - x.restockedAt < 4000
            return (
              <tr key={e.id}>
                <td><b>{e.id}</b><small>{e.origin}</small></td>
                {two ? (
                  <>
                    <td key={`b${x.n}`} className={cls}>{fmt(x.bid, dp)}</td>
                    <td key={`a${x.n}`} className={cls}>{fmt(x.ask, dp)}</td>
                  </>
                ) : (
                  <td key={`v${x.n}`} className={cls}>{fmt(x.last, dp)}</td>
                )}
                {lv ? (
                  <>
                    <td className="hide-s"><div className={`inv-bar ${state}`}><i style={{ width: `${Math.min(100, (ratio / lv.capacity) * 100)}%` }} /></div></td>
                    <td><em className={`status ${fresh ? 's-ack' : state === 'ok' ? 's-fill' : state === 'low' ? 's-part' : 's-rej'}`}>{fresh ? lv.labels.restock : lv.labels[state]}</em></td>
                  </>
                ) : (
                  <td className={x.chg >= 0 ? 'up' : 'dn'}>{x.chg >= 0 ? '▲' : '▼'} {Math.abs(x.chg).toFixed(2)}%</td>
                )}
                <td className="hide-s"><Spark data={x.hist} up={lv ? x.last >= x.hist[0] : x.chg >= 0} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const TONE_CLS = { new: 's-new', ack: 's-ack', partial: 's-part', done: 's-fill', bad: 's-rej' } as const
// Relative column widths, per format. Together these reproduce the original 9-column blotter grid.
const WEIGHT: Record<ColumnFormat, number> = { id: 1.2, side: 0.6, text: 0.8, int: 1, progress: 1.2, price: 1, status: 1 }
const gridOf = (cols: Column[]) => cols.map((c) => `minmax(0, ${c.weight ?? WEIGHT[c.format]}fr)`).join(' ')

const rawOf = (it: Item, key: string): string | number => {
  switch (key) {
    case 'id': return it.id
    case 'entity': return it.entity
    case 'origin': return it.origin
    case 'group': return it.group
    case 'status': return it.status
    case 'qty': return it.qty
    case 'filled': return it.filled
    case 'avgValue': return it.avgValue
    default: return it.fields[key] ?? ''
  }
}

function Cell({ sc, col, it }: { sc: Scenario; col: Column; it: Item }) {
  const small = col.hideSmall ? 'hide-s' : undefined
  const v = rawOf(it, col.key)
  switch (col.format) {
    case 'id': return <span className="muted">{v}</span>
    case 'side': return <span className={v === 'BUY' ? 'up' : 'dn'}><b>{v}</b></span>
    case 'int': return <span className={small}>{Number(v).toLocaleString()}</span>
    case 'progress': {
      const pct = Math.min(100, (it.filled / it.qty) * 100)
      return <span className="fillbar"><i style={{ width: `${pct}%` }} />{pct.toFixed(0)}%</span>
    }
    case 'price': {
      const dp = sc.model.entities.find((e) => e.id === it.entity)?.value.decimals ?? 2
      return <span className={small}>{it.avgValue ? fmt(it.avgValue, dp) : '—'}</span>
    }
    case 'status': {
      const tone = sc.lifecycle.statuses.find((s) => s.id === it.status)?.tone ?? 'new'
      return <span><motion.em key={it.status} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className={`status ${TONE_CLS[tone]}`}>{it.status}</motion.em></span>
    }
    default: return <span className={`txt ${small ?? ''}`}>{col.key === 'entity' ? <b>{v}</b> : v}</span>
  }
}

function Tracker() {
  const sc = useScenario()
  const { blotter: bl, lifecycle: lc } = sc
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState({ n: 0, done: 0, value: 0, bad: 0 })
  const [facet, setFacet] = useState<string>('*')
  const map = useRef(new Map<string, Item>())
  const order = useRef<string[]>([])
  const tot = useRef({ n: 0, done: 0, value: 0, bad: 0 })
  const tone = (status: string | undefined) => lc.statuses.find((s) => s.id === status)?.tone

  const sub = facet === '*' ? lifecycleRoot(sc) : facetSubscription(sc, bl.facet, facet)

  useEffect(() => {
    map.current.clear(); order.current = []
    const un = broker.subscribe<Item>(sub, (m) => {
      const it = m.payload
      if (!map.current.has(it.id)) {
        order.current.unshift(it.id)
        tot.current.n++
        if (order.current.length > 14) map.current.delete(order.current.pop()!)
      }
      const prev = map.current.get(it.id)
      if (tone(it.status) === 'done' && tone(prev?.status) !== 'done') { tot.current.done++; tot.current.value += it.qty * it.avgValue }
      if (tone(it.status) === 'bad' && tone(prev?.status) !== 'bad') tot.current.bad++
      map.current.set(it.id, it)
    })
    const iv = setInterval(() => {
      setItems(order.current.map((id) => map.current.get(id)!).filter(Boolean))
      setTotals({ ...tot.current })
    }, 180)
    return () => { un(); clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub])

  const cols = bl.columns
  const small = useMemo(() => cols.filter((c) => !c.hideSmall), [cols])
  const vars = { ['--ob-cols' as string]: gridOf(cols), ['--ob-cols-s' as string]: gridOf(small), ['--kpis' as string]: bl.kpis.value ? 4 : 3 }
  const money = (v: number) => `${bl.kpis.value?.prefix ?? ''}${v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(1)}M`}`

  return (
    <div className="panel ob" style={vars}>
      <div className="bl-h">
        <span className="live" />{bl.title} <em className="mono">{sub}</em>
        <div className="desk-chips">
          {['*', ...lc.facets[bl.facet]].map((d) => (
            <button key={d} className={`chip ${facet === d ? 'on' : ''}`} onClick={() => setFacet(d)}>{d === '*' ? bl.allLabel : d}</button>
          ))}
        </div>
      </div>
      <div className="ob-kpis mono">
        <div><b>{totals.n.toLocaleString()}</b><span>{bl.kpis.total}</span></div>
        <div><b className="up">{totals.done.toLocaleString()}</b><span>{bl.kpis.done}</span></div>
        {bl.kpis.value && <div><b>{money(totals.value)}</b><span>{bl.kpis.value.label}</span></div>}
        <div><b className="dn">{totals.bad}</b><span>{bl.kpis.bad}</span></div>
      </div>
      <div className="ob-table mono">
        <div className="ob-row ob-head">
          {cols.map((c) => <span key={c.key} className={c.hideSmall ? 'hide-s' : undefined}>{c.label}</span>)}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((it) => (
            <motion.div key={it.id} layout initial={{ opacity: 0, y: -16, backgroundColor: 'rgba(0,200,149,0.25)' }}
              animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.4 }} className="ob-row">
              {cols.map((c) => <Cell key={c.key} sc={sc} col={c} it={it} />)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default function Blotter() {
  return (
    <section id="blotter" className="fit">
      <div className="wrap">
        <ScenarioHead id="blotter" split />
        <Reveal delay={0.1}>
          <div className="bl-grid">
            <Tracker />
            <Watch />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
