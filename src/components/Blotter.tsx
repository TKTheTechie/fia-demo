import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { broker } from '../lib/broker'
import { INSTRUMENTS, Tick, fmt, marketTopic } from '../lib/market'
import { Order } from '../lib/orders'
import { SectionHead, Reveal } from './Section'

const dpOf = Object.fromEntries(INSTRUMENTS.map((i) => [i.sym, i.dp]))

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

type Q = Tick & { dir: 0 | 1 | -1; hist: number[]; n: number }

function MarketWatch() {
  const [q, setQ] = useState<Record<string, Q>>({})
  const buf = useRef<Record<string, Q>>({})
  useEffect(() => {
    const uns = INSTRUMENTS.map((i) => broker.subscribe<Tick>(marketTopic(i), (m) => {
      const prev = buf.current[i.sym]
      const hist = prev ? [...prev.hist, m.payload.last].slice(-40) : [m.payload.last]
      buf.current[i.sym] = { ...m.payload, dir: prev ? (m.payload.last > prev.last ? 1 : m.payload.last < prev.last ? -1 : 0) : 0, hist, n: (prev?.n ?? 0) + 1 }
    }))
    const iv = setInterval(() => setQ({ ...buf.current }), 200)
    return () => { uns.forEach((u) => u()); clearInterval(iv) }
  }, [])
  return (
    <div className="panel mw">
      <div className="bl-h"><span className="live" />MARKET WATCH <em className="mono">md/&gt;</em></div>
      <table className="mono">
        <thead><tr><th>SYM</th><th>BID</th><th>ASK</th><th>CHG</th><th className="hide-s">TREND</th></tr></thead>
        <tbody>
          {INSTRUMENTS.map((i) => {
            const x = q[i.sym]
            if (!x) return <tr key={i.sym}><td>{i.sym}</td><td colSpan={4}>—</td></tr>
            const cls = x.dir > 0 ? 'flash-up' : x.dir < 0 ? 'flash-dn' : ''
            return (
              <tr key={i.sym}>
                <td><b>{i.sym}</b><small>{i.venue}</small></td>
                <td key={`b${x.n}`} className={cls}>{fmt(x.bid, i.dp)}</td>
                <td key={`a${x.n}`} className={cls}>{fmt(x.ask, i.dp)}</td>
                <td className={x.chg >= 0 ? 'up' : 'dn'}>{x.chg >= 0 ? '▲' : '▼'} {Math.abs(x.chg).toFixed(2)}%</td>
                <td className="hide-s"><Spark data={x.hist} up={x.chg >= 0} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const STATUS_CLS: Record<string, string> = { NEW: 's-new', ACK: 's-ack', PARTIAL: 's-part', FILLED: 's-fill', REJECTED: 's-rej', CANCELLED: 's-rej' }

function OrderBlotter() {
  const [orders, setOrders] = useState<Order[]>([])
  const [totals, setTotals] = useState({ n: 0, filled: 0, notional: 0, rej: 0 })
  const [deskFilter, setDesk] = useState<string>('*')
  const map = useRef(new Map<string, Order>())
  const order = useRef<string[]>([])
  const tot = useRef({ n: 0, filled: 0, notional: 0, rej: 0 })

  useEffect(() => {
    const sub = deskFilter === '*' ? 'trade/>' : `trade/*/*/${deskFilter}/>`
    map.current.clear(); order.current = []
    const un = broker.subscribe<Order>(sub, (m) => {
      const o = m.payload
      if (!map.current.has(o.id)) {
        order.current.unshift(o.id)
        tot.current.n++
        if (order.current.length > 14) map.current.delete(order.current.pop()!)
      }
      const prev = map.current.get(o.id)
      if (o.status === 'FILLED' && prev?.status !== 'FILLED') { tot.current.filled++; tot.current.notional += o.qty * o.avgPx }
      if (o.status === 'REJECTED' && prev?.status !== 'REJECTED') tot.current.rej++
      map.current.set(o.id, o)
    })
    const iv = setInterval(() => {
      setOrders(order.current.map((id) => map.current.get(id)!).filter(Boolean))
      setTotals({ ...tot.current })
    }, 180)
    return () => { un(); clearInterval(iv) }
  }, [deskFilter])

  return (
    <div className="panel ob">
      <div className="bl-h">
        <span className="live" />ORDER BLOTTER <em className="mono">{deskFilter === '*' ? 'trade/>' : `trade/*/*/${deskFilter}/>`}</em>
        <div className="desk-chips">
          {['*', 'ALGO', 'DELTA1', 'MACRO', 'FXSPOT', 'VOL'].map((d) => (
            <button key={d} className={`chip ${deskFilter === d ? 'on' : ''}`} onClick={() => setDesk(d)}>{d === '*' ? 'ALL DESKS' : d}</button>
          ))}
        </div>
      </div>
      <div className="ob-kpis mono">
        <div><b>{totals.n.toLocaleString()}</b><span>orders</span></div>
        <div><b className="up">{totals.filled.toLocaleString()}</b><span>filled</span></div>
        <div><b>${totals.notional >= 1e9 ? `${(totals.notional / 1e9).toFixed(2)}B` : `${(totals.notional / 1e6).toFixed(1)}M`}</b><span>notional</span></div>
        <div><b className="dn">{totals.rej}</b><span>risk rejects</span></div>
      </div>
      <div className="ob-table mono">
        <div className="ob-row ob-head">
          <span>ORDER</span><span>SIDE</span><span>SYM</span><span className="hide-s">DESK</span><span className="hide-s">ALGO</span><span>QTY</span><span>FILLED</span><span className="hide-s">AVG PX</span><span>STATUS</span>
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {orders.map((o) => {
            const pct = Math.min(100, (o.filled / o.qty) * 100)
            return (
              <motion.div key={o.id} layout initial={{ opacity: 0, y: -16, backgroundColor: 'rgba(0,200,149,0.25)' }}
                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.4 }} className="ob-row">
                <span className="muted">{o.id}</span>
                <span className={o.side === 'BUY' ? 'up' : 'dn'}><b>{o.side}</b></span>
                <span><b>{o.sym}</b></span>
                <span className="hide-s">{o.desk}</span>
                <span className="hide-s">{o.strategy}</span>
                <span>{o.qty.toLocaleString()}</span>
                <span className="fillbar"><i style={{ width: `${pct}%` }} />{pct.toFixed(0)}%</span>
                <span className="hide-s">{o.avgPx ? fmt(o.avgPx, dpOf[o.sym]) : '—'}</span>
                <span><motion.em key={o.status} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className={`status ${STATUS_CLS[o.status]}`}>{o.status}</motion.em></span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default function Blotter() {
  return (
    <section id="blotter" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="07 · Live blotter"
          title={<>Every screen, <span className="grad">streaming</span> in real time.</>}
          lede="Trader UIs subscribe straight to the mesh over WebSocket — no polling, no middle tier. Filter by desk and the subscription changes on the broker; only the events you need hit the glass."
        />
        <Reveal delay={0.1}>
          <div className="bl-grid">
            <OrderBlotter />
            <MarketWatch />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
