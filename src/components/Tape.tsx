import { useEffect, useState } from 'react'
import { broker } from '../lib/broker'
import { fmt } from '../lib/format'
import { useScenario } from '../lib/scenario'
import { feedSubscription, type Tick } from '../lib/sim/stream'

export default function Tape() {
  const sc = useScenario()
  const [q, setQ] = useState<Record<string, Tick>>({})
  useEffect(() => {
    const buf: Record<string, Tick> = {}
    const un = broker.subscribe<Tick>(feedSubscription(sc), (m) => (buf[m.payload.id] = m.payload))
    const iv = setInterval(() => setQ({ ...buf }), 800)
    return () => { un(); clearInterval(iv) }
  }, [sc])
  const items = sc.model.entities.map((e) => {
    const t = q[e.id]
    return (
      <div key={e.id} className="tape-item">
        <span className="s">{e.id}</span>
        <span>{fmt(t?.last ?? e.value.start, e.value.decimals)}</span>
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
