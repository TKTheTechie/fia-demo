import { AnimatePresence, motion, useInView } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Broker } from '../lib/broker'
import { fmt } from '../lib/format'
import { isPaused, scaled } from '../lib/pause'
import { useScenario } from '../lib/scenario'
import { KRec, kindOf, makeRecord, pick, pickTopic, topicPrefix } from '../lib/sim/records'
import { feedSubscription } from '../lib/sim/stream'
import type { FieldRef, KafkaTopic, Scenario } from '../scenarios/types'
import { renderRich } from '../lib/rich'
import { Reveal } from './Section'

// Kafka → Solace → trader UI.
// A simulated Kafka cluster appends market-data records to a few *flat* topics
// (event type in the topic name, asset/venue/symbol in record headers). The
// integrated Kafka bridge runs *inside* the Solace broker: it can only read the
// Kafka topic name and the record headers to build the hierarchical Solace
// topic — the record value is passed through untouched, never parsed. The
// blotter then subscribes to exactly the slice it wants and the broker does the
// filtering. Runs on its own bus so it doesn't double the page feed.

const LOG_LEN = 5
const KIND_CLS = ['s-new', 's-part', 's-ack']

/** How a record's headline value is shown, per the Kafka topic's `render`. */
export function Value({ r, render = 'value' }: { r: KRec; render?: 'bidask' | 'value' | 'delta' }) {
  if (render === 'bidask') return <>{fmt(r.bid, r.dp)} <i className="muted">/</i> {fmt(r.ask, r.dp)}</>
  if (render === 'delta') return <span className={r.delta >= 0 ? 'up' : 'dn'}>{r.delta >= 0 ? '+' : '−'}{Math.abs(r.delta).toLocaleString()}</span>
  return <>{fmt(r.value, r.dp)}</>
}

const bus = new Broker()

type LogView = Record<string, { offset: number; parts: { id: number; key: string }[][] }>
type MapRow = { id: number; from: string; hdr: string; to: string }
const emptyLogs = (topics: KafkaTopic[]): LogView =>
  Object.fromEntries(topics.map((t) => [t.name, { offset: 0, parts: Array.from({ length: t.partitions }, () => []) }]))
const MAX_PARTS = 12

/** The filter subscription: each bridge segment becomes a literal, a chip/text filter, or '*'. */
function subscriptionFor(sc: Scenario, chip: string, kind: string, idText: string) {
  const ui = sc.kafka.ui
  if (chip === '*' && kind === '*' && idText === '*') return feedSubscription(sc)
  return sc.kafka.bridge.segments
    .map((seg) => ('literal' in seg ? seg.literal : 'header' in seg ? (seg.header === ui.chipHeader ? chip : seg.header === ui.idHeader ? idText : '*') : kind))
    .join('/')
}

/** Load imbalance across a topic's partitions, for the cluster view. */
function skew(c?: number[]) {
  const total = c?.reduce((a, b) => a + b, 0) ?? 0
  if (!c || total < 10) return ''
  const top = c.indexOf(Math.max(...c))
  return `busiest P${top} ${Math.round((c[top] / total) * 100)}%`
}

const clock = (ts: number) => {
  const d = new Date(ts)
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export default function KafkaBridge() {
  const sc = useScenario()
  const ui = sc.kafka.ui
  // Partition count and record key are tunable live; the scenario's values are the defaults.
  const base = sc.kafka.topics
  const [partsDelta, setParts] = useState(0)
  const [keyOverride, setKey] = useState<FieldRef | null>(null)
  const topics = useMemo(
    () => base.map((t) => ({ ...t, partitions: Math.min(MAX_PARTS, Math.max(1, t.partitions + partsDelta)), keyBy: keyOverride ?? t.keyBy })),
    [base, partsDelta, keyOverride],
  )
  // Keys on offer: the first topic's headers (each maps to an entity field), e.g. sku / store / category / region.
  const keyOptions = Object.entries(base[0].headers).map(([header, field]) => ({ header, field }))
  const keyField = keyOverride ?? base[0].keyBy
  const keyName = keyOptions.find((o) => o.field === keyField)?.header ?? String(keyField)
  const partCount = topics[0].partitions
  const canShrink = topics.some((t) => t.partitions > 1)
  const canGrow = topics.some((t) => t.partitions < MAX_PARTS)
  const totalRows = topics.reduce((a, t) => a + t.partitions, 0)
  const prefix = topicPrefix(sc)
  const kinds = ['*', ...topics.map((t) => kindOf(sc, t.name))]
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-80px' })

  const [logs, setLogs] = useState<LogView>(() => emptyLogs(topics))
  const [maps, setMaps] = useState<MapRow[]>([])
  const [rows, setRows] = useState<KRec[]>([])
  const [rate, setRate] = useState(0)
  const [stats, setStats] = useState({ kafka: 0, delivered: 0 })

  const [asset, setAsset] = useState('*')
  const [kind, setKind] = useState('*')
  const [symRaw, setSymRaw] = useState('')
  const sym = symRaw.toUpperCase().replace(/[^A-Z0-9*]/g, '') || '*'
  const sub = subscriptionFor(sc, asset, kind, sym)

  const logRef = useRef<LogView>(emptyLogs(topics))
  const recId = useRef(0) // survives restarts so row keys never repeat
  const partCounts = useRef<Record<string, number[]>>({})
  const mapBuf = useRef<MapRow[]>([])
  const rowBuf = useRef<KRec[]>([])
  const counts = useRef({ kafka: 0, delivered: 0, sec: 0 })

  // A new key or partition count starts fresh logs, like re-creating the topic.
  useEffect(() => {
    logRef.current = emptyLogs(topics)
    partCounts.current = Object.fromEntries(topics.map((k) => [k.name, Array(k.partitions).fill(0)]))
    setLogs(structuredClone(logRef.current))
  }, [topics])

  // Producer → Kafka log → bridge → Solace bus. Only runs while on screen.
  useEffect(() => {
    if (!inView) return
    let t = 0
    const offsets = new Map(topics.map((k) => [k.name, 1_840_000 + Math.floor(Math.random() * 90_000)]))
    const loop = () => {
      if (isPaused()) { t = window.setTimeout(loop, 200); return }
      const burst = 1 + Math.floor(Math.random() * 2)
      for (let n = 0; n < burst; n++) {
        const { index } = pickTopic(sc)
        const kt = topics[index]
        const rec = makeRecord(sc, pick(sc.model.entities), kt, index, recId.current++)
        partCounts.current[kt.name][rec.part]++
        const offset = offsets.get(kt.name)! + 1
        offsets.set(kt.name, offset)
        rec.offset = offset
        // 1. append to the flat Kafka topic
        const lv = logRef.current[kt.name]
        lv.offset = offset
        lv.parts[rec.part] = [...lv.parts[rec.part], { id: rec.id, key: rec.key }].slice(-LOG_LEN)
        counts.current.kafka++; counts.current.sec++
        // 2. in-broker bridge maps Kafka topic + headers onto a hierarchical Solace topic
        mapBuf.current.push({ id: rec.id, from: `${kt.name}·p${rec.part}·@${offset.toLocaleString()}`, hdr: Object.entries(rec.headers).map(([k, v]) => `${k}=${v}`).join(' '), to: rec.solaceTopic })
        bus.publish(rec.solaceTopic, rec)
      }
      t = window.setTimeout(loop, scaled(320 + Math.random() * 280))
    }
    loop()
    return () => clearTimeout(t)
  }, [inView, sc, topics])

  // Blotter: a broker-side subscription; re-subscribes whenever a filter changes.
  useEffect(() => {
    counts.current.kafka = 0; counts.current.delivered = 0
    rowBuf.current = []
    setRows([])
    return bus.subscribe<KRec>(sub, (m) => {
      counts.current.delivered++
      rowBuf.current.push(m.payload)
    })
  }, [sub])

  useEffect(() => {
    const iv = setInterval(() => {
      setLogs(structuredClone(logRef.current))
      if (mapBuf.current.length) { const add = mapBuf.current.slice(-2).reverse(); mapBuf.current = []; setMaps((r) => [...add, ...r].slice(0, 12)) }
      if (rowBuf.current.length) { const add = rowBuf.current.slice(-3).reverse(); rowBuf.current = []; setRows((r) => [...add, ...r].slice(0, 18)) }
      setStats({ kafka: counts.current.kafka, delivered: counts.current.delivered })
    }, 550)
    const rv = setInterval(() => { setRate(counts.current.sec); counts.current.sec = 0 }, 1000)
    return () => { clearInterval(iv); clearInterval(rv) }
  }, [])

  const filtered = stats.kafka ? Math.max(0, (1 - stats.delivered / stats.kafka) * 100) : 0

  return (
    <div ref={ref} data-pane="bridge">
        {sc.copy.kafka?.extra && <p className="lede kb-intro">{renderRich(sc.copy.kafka.extra)}</p>}
        <Reveal delay={0.1}>
          <div className="kb-grid">
            {/* 1 · Kafka cluster */}
            <div className="panel kb-col">
              <div className="bl-h"><span className="kb-k">K</span>KAFKA CLUSTER <em className="mono">flat topics</em></div>
              <div className="kb-ctl mono">
                <div className="kb-frow">
                  <label>KEY</label>
                  {keyOptions.map((o) => (
                    <button key={o.header} data-key={o.header} className={`chip ${o.field === keyField ? 'on' : ''}`} onClick={() => setKey(o.field === base[0].keyBy ? null : o.field)}>{o.header}</button>
                  ))}
                </div>
                <div className="kb-frow">
                  <label>PARTS</label>
                  <button className="chip" data-parts="dec" aria-label="Fewer partitions" disabled={!canShrink} onClick={() => setParts((d) => d - 1)}>−</button>
                  <b className="kb-pn">{partCount}</b>
                  <button className="chip" data-parts="inc" aria-label="More partitions" disabled={!canGrow} onClick={() => setParts((d) => d + 1)}>+</button>
                  <span className="kb-hint">each topic · hash(key) % partitions</span>
                </div>
              </div>
              <div className="kb-topics mono" style={totalRows > 14 ? { ['--kb-prow' as string]: `${Math.max(9, Math.floor(280 / totalRows))}px` } : undefined}>
                {topics.map((t) => (
                  <div key={t.name} className="kb-topic">
                    <div className="kb-th"><b>{t.name}</b><span>{t.partitions}p</span><span className="kb-skew">{skew(partCounts.current[t.name])}</span><em>@{logs[t.name]?.offset.toLocaleString()}</em></div>
                    {(logs[t.name]?.parts ?? []).map((p, pi) => (
                      <div key={pi} className="kb-part">
                        <span>P{pi}</span>
                        <div className="kb-log">
                          <AnimatePresence initial={false} mode="popLayout">
                            {p.map((r) => (
                              <motion.i key={r.id} layout initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.6 }}>{r.key}</motion.i>
                            ))}
                          </AnimatePresence>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="kb-rec mono">
                <span>RECORD</span><em>topic</em><em>key={keyName}</em><em className="on">headers</em><em className="off">value</em>
              </div>
            </div>

            <div className="kb-pipe" aria-hidden><i /><i /><i /></div>

            {/* 2 · Solace broker, with the Kafka bridge running inside it */}
            <div className="panel kb-col kb-broker">
              <div className="bl-h"><span className="live kb-live" />SOLACE EVENT BROKER</div>
              <div className="kb-bridge">
                <div className="kb-bridge-h mono"><b>INTEGRATED KAFKA BRIDGE</b><span>in-broker</span></div>
                <div className="kb-core">
                  <b>{rate.toLocaleString()}</b><span>records / sec bridged</span>
                </div>
                <div className="kb-rule mono">
                  <div><em>reads</em><b>topic</b> {prefix}<b>{'{type}'}</b> + <b>headers</b></div>
                  <div className="kb-arrow">↓ topic name + headers only · payload untouched ↓</div>
                  <div><em>solace</em>{sc.kafka.bridge.segments.map((seg, i) => (
                    <span key={i}>{i > 0 && '/'}{'literal' in seg ? seg.literal : <b>{'header' in seg ? `{hdr.${seg.header}}` : '{type}'}</b>}</span>
                  ))}</div>
                </div>
                <div className="kb-maps mono">
                  <AnimatePresence initial={false} mode="popLayout">
                    {maps.map((m) => (
                      <motion.div key={m.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.7 }} className="kb-map">
                        <span className="muted">{m.from}</span>
                        <span className="kb-hdr">hdr {m.hdr}</span>
                        <span>→ {m.to}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
              <div className="kb-router mono">↓ broker topic routing · subscription filter ↓</div>
            </div>

            <div className="kb-pipe" aria-hidden><i /><i /><i /></div>

            {/* 3 · Trader blotter */}
            <div className="panel kb-col kb-blotter">
              <div className="bl-h"><span className="live" />{sc.title.toUpperCase()} STREAM <em className="mono">WebSocket</em></div>
              <div className="kb-filters" style={{ ['--kb-lbl' as string]: `${Math.max(42, 7 * Math.max(ui.chipLabel.length, ui.typeLabel.length) + 2)}px` }}>
                <div className="kb-frow">
                  <label className="mono">{ui.chipLabel}</label>
                  {[{ id: '*', label: 'ALL' }, ...ui.chips].map((c) => (
                    <button key={c.id} className={`chip ${asset === c.id ? 'on' : ''}`} onClick={() => setAsset(c.id)}>{c.id === '*' ? 'ALL' : c.label.toUpperCase()}</button>
                  ))}
                </div>
                <div className="kb-frow">
                  <label className="mono">{ui.typeLabel}</label>
                  {kinds.map((k) => (
                    <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === '*' ? 'ALL' : k.toUpperCase()}</button>
                  ))}
                  <label className="mono kb-symlbl">{ui.idLabel}</label>
                  <input className="kb-sym mono" value={symRaw} onChange={(e) => setSymRaw(e.target.value)} placeholder={ui.idPlaceholder} spellCheck={false} aria-label={`${ui.idLabel} filter`} />
                </div>
                <div className="kb-sub mono"><span>SUBSCRIPTION</span><code>{sub}</code></div>
              </div>
              <div className="kb-kpis mono">
                <div><b>{stats.kafka.toLocaleString()}</b><span>records on Kafka</span></div>
                <div><b className="up">{stats.delivered.toLocaleString()}</b><span>pushed to blotter</span></div>
                <div><b>{filtered.toFixed(1)}%</b><span>filtered at broker</span></div>
              </div>
              <div className="kb-table mono">
                <div className="kb-row kb-head"><span>TIME</span><span>{ui.idLabel}</span><span className="hide-s">{ui.originLabel}</span><span>{ui.typeLabel}</span><span>{ui.valueLabel}</span><span>{ui.extra.label}</span></div>
                <AnimatePresence key={sub} initial={false} mode="popLayout">
                  {rows.map((r) => (
                    <motion.div key={r.id} layout initial={{ opacity: 0, y: -14, backgroundColor: 'rgba(42,183,255,0.22)' }}
                      animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.8 }} className="kb-row">
                      <span className="muted">{clock(r.ts)}</span>
                      <span><b>{r.entityId}</b></span>
                      <span className="hide-s muted">{r.origin}</span>
                      <span><em className={`status ${KIND_CLS[r.kindIndex] ?? 's-ack'}`}>{r.kind.toUpperCase()}</em></span>
                      <span><Value r={r} render={topics[r.kindIndex].render} /></span>
                      <span>{ui.extra.header ? r.headers[ui.extra.header] : r.size.toLocaleString()}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {!rows.length && <div className="kb-empty muted">waiting for events on <b>{sub}</b>…</div>}
              </div>
            </div>
          </div>
        </Reveal>
    </div>
  )
}
