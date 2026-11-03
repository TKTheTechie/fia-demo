import { useEffect, useState } from 'react'
import { broker } from '../lib/broker'
import { INSTRUMENTS, Tick, fmt } from '../lib/market'

export default function Tape() {
  const [q, setQ] = useState<Record<string, Tick>>({})
  useEffect(() => {
    const buf: Record<string, Tick> = {}
    const un = broker.subscribe<Tick>('md/>', (m) => (buf[m.payload.sym] = m.payload))
    const iv = setInterval(() => setQ({ ...buf }), 800)
    return () => { un(); clearInterval(iv) }
  }, [])
  const items = INSTRUMENTS.map((i) => {
    const t = q[i.sym]
    return (
      <div key={i.sym} className="tape-item">
        <span className="s">{i.sym}</span>
        <span>{fmt(t?.last ?? i.px, i.dp)}</span>
        {t && <span className={t.chg >= 0 ? 'up' : 'dn'}>{t.chg >= 0 ? '▲' : '▼'}{Math.abs(t.chg).toFixed(2)}%</span>}
      </div>
    )
  })
  return (
    <div className="tape" aria-hidden>
      <div className="tape-track">{items}{items.map((x) => <div key={`d${x.key}`} className="tape-item">{x.props.children}</div>)}</div>
    </div>
  )
}
