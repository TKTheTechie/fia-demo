import { AnimatePresence, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Broker } from '../lib/broker'
import { INSTRUMENTS, Instrument, fmt } from '../lib/market'
import { SectionHead, Reveal } from './Section'

// Kafka → Solace → trader UI.
// A simulated Kafka cluster appends market-data records to a few *flat* topics
// (event type in the topic name, asset/venue/symbol in record headers). The
// integrated Kafka bridge runs *inside* the Solace broker: it can only read the
// Kafka topic name and the record headers to build the hierarchical Solace
// topic — the record value is passed through untouched, never parsed. The
// blotter then subscribes to exactly the slice it wants and the broker does the
// filtering. Runs on its own bus so it doesn't double the page feed.

type Kind = 'quote' | 'trade'
type KHeaders = { asset: Instrument['asset']; venue: string; sym: string }
type KRec = {
  id: number; topic: string; part: number; offset: number; headers: KHeaders
  sym: string; asset: Instrument['asset']; venue: string; kind: Kind
  bid: number; ask: number; px: number; size: number; dp: number; ts: number
}

const KTOPICS = [
  { name: 'mktdata.quote', parts: 7 },
  { name: 'mktdata.trade', parts: 7 },
]
const LOG_LEN = 5

const kafkaTopicFor = (kind: Kind) => `mktdata.${kind}`
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
// The bridge's whole view of a record: Kafka topic name + headers. No payload access.
const solaceTopic = (kafkaTopic: string, h: KHeaders) =>
  `md/${h.asset}/${h.venue}/${h.sym}/${kafkaTopic.split('.').pop()}`

const bus = new Broker()

type LogView = Record<string, { offset: number; parts: { id: number; key: string }[][] }>
type MapRow = { id: number; from: string; hdr: string; to: string }
const emptyLogs = (): LogView =>
  Object.fromEntries(KTOPICS.map((t) => [t.name, { offset: 0, parts: Array.from({ length: t.parts }, () => []) }]))

const ASSETS = ['*', 'equities', 'futures', 'fx', 'rates', 'crypto'] as const
const KINDS = ['*', 'quote', 'trade'] as const

const clock = (ts: number) => {
  const d = new Date(ts)
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export default function KafkaBridge() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { margin: '-80px' })

  const [logs, setLogs] = useState<LogView>(emptyLogs)
  const [maps, setMaps] = useState<MapRow[]>([])
  const [rows, setRows] = useState<KRec[]>([])
  const [rate, setRate] = useState(0)
  const [stats, setStats] = useState({ kafka: 0, delivered: 0 })

  const [asset, setAsset] = useState<(typeof ASSETS)[number]>('*')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('*')
  const [symRaw, setSymRaw] = useState('')
  const sym = symRaw.toUpperCase().replace(/[^A-Z0-9*]/g, '') || '*'
  const allWild = asset === '*' && kind === '*' && sym === '*'
  const sub = allWild ? 'md/>' : `md/${asset}/*/${sym}/${kind}`

  const logRef = useRef<LogView>(emptyLogs())
  const mapBuf = useRef<MapRow[]>([])
  const rowBuf = useRef<KRec[]>([])
  const counts = useRef({ kafka: 0, delivered: 0, sec: 0 })

  // Producer → Kafka log → bridge → Solace bus. Only runs while on screen.
  useEffect(() => {
    if (!inView) return
    let id = 0, t = 0
    const offsets = new Map(KTOPICS.map((k) => [k.name, 1_840_000 + Math.floor(Math.random() * 90_000)]))
    const loop = () => {
      const burst = 1 + Math.floor(Math.random() * 2)
      for (let n = 0; n < burst; n++) {
        const i = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)]
        const k: Kind = Math.random() < 0.62 ? 'quote' : 'trade'
        const topic = kafkaTopicFor(k)
        const parts = KTOPICS.find((x) => x.name === topic)!.parts
        const part = hash(i.sym) % parts
        const offset = offsets.get(topic)! + 1
        offsets.set(topic, offset)
        const px = i.px * (1 + (Math.random() - 0.5) * i.vol)
        const spread = px * 0.00005 + Math.pow(10, -i.dp)
        const rec: KRec = {
          id: id++, topic, part, offset, headers: { asset: i.asset, venue: i.venue, sym: i.sym }, sym: i.sym, asset: i.asset, venue: i.venue, kind: k,
          bid: px - spread / 2, ask: px + spread / 2, px, dp: i.dp, ts: Date.now(),
          size: Math.ceil(Math.random() * 50) * (i.asset === 'equities' ? 100 : 1),
        }
        // 1. append to the flat Kafka topic
        const lv = logRef.current[topic]
        lv.offset = offset
        lv.parts[part] = [...lv.parts[part], { id: rec.id, key: rec.sym }].slice(-LOG_LEN)
        counts.current.kafka++; counts.current.sec++
        // 2. in-broker bridge maps Kafka topic + headers onto a hierarchical Solace topic
        const h = rec.headers
        const to = solaceTopic(topic, h)
        mapBuf.current.push({ id: rec.id, from: `${topic}·p${part}·@${offset.toLocaleString()}`, hdr: `asset=${h.asset} venue=${h.venue} sym=${h.sym}`, to })
        bus.publish(to, rec)
      }
      t = window.setTimeout(loop, 320 + Math.random() * 280)
    }
    loop()
    return () => clearTimeout(t)
  }, [inView])

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
    <section id="kafka" className="fit" ref={ref}>
      <div className="wrap">
        <SectionHead
          split
          eyebrow="07 · Kafka bridge"
          title={<>Kafka in. <span className="grad">Precise streams</span> out.</>}
          lede={<>Market data lands on flat Kafka topics. The Kafka bridge is integrated inside the Solace broker — no separate connector to run. It builds a hierarchical Solace topic from just the Kafka topic name and record headers, passing the payload through untouched — so each trader UI subscribes to just the asset class, symbol or event type it needs, filtered in the broker and pushed straight to the glass.</>}
        />
        <Reveal delay={0.1}>
          <div className="kb-grid">
            {/* 1 · Kafka cluster */}
            <div className="panel kb-col">
              <div className="bl-h"><span className="kb-k">K</span>KAFKA CLUSTER <em className="mono">flat topics</em></div>
              <div className="kb-topics mono">
                {KTOPICS.map((t) => (
                  <div key={t.name} className="kb-topic">
                    <div className="kb-th"><b>{t.name}</b><span>{t.parts}p</span><em>@{logs[t.name].offset.toLocaleString()}</em></div>
                    {logs[t.name].parts.map((p, pi) => (
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
                <span>RECORD</span><em>topic</em><em>key=SYM</em><em className="on">headers</em><em className="off">value</em>
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
                  <div><em>reads</em><b>topic</b> mktdata.<b>{'{type}'}</b> + <b>headers</b></div>
                  <div className="kb-arrow">↓ topic name + headers only · payload untouched ↓</div>
                  <div><em>solace</em>md/<b>{'{hdr.asset}'}</b>/<b>{'{hdr.venue}'}</b>/<b>{'{hdr.sym}'}</b>/<b>{'{type}'}</b></div>
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
              <div className="bl-h"><span className="live" />MARKET DATA BLOTTER <em className="mono">WebSocket</em></div>
              <div className="kb-filters">
                <div className="kb-frow">
                  <label className="mono">ASSET</label>
                  {ASSETS.map((a) => (
                    <button key={a} className={`chip ${asset === a ? 'on' : ''}`} onClick={() => setAsset(a)}>{a === '*' ? 'ALL' : a.toUpperCase()}</button>
                  ))}
                </div>
                <div className="kb-frow">
                  <label className="mono">TYPE</label>
                  {KINDS.map((k) => (
                    <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === '*' ? 'ALL' : k.toUpperCase()}</button>
                  ))}
                  <label className="mono kb-symlbl">SYM</label>
                  <input className="kb-sym mono" value={symRaw} onChange={(e) => setSymRaw(e.target.value)} placeholder="* or N*" spellCheck={false} aria-label="Symbol filter" />
                </div>
                <div className="kb-sub mono"><span>SUBSCRIPTION</span><code>{sub}</code></div>
              </div>
              <div className="kb-kpis mono">
                <div><b>{stats.kafka.toLocaleString()}</b><span>records on Kafka</span></div>
                <div><b className="up">{stats.delivered.toLocaleString()}</b><span>pushed to blotter</span></div>
                <div><b>{filtered.toFixed(1)}%</b><span>filtered at broker</span></div>
              </div>
              <div className="kb-table mono">
                <div className="kb-row kb-head"><span>TIME</span><span>SYM</span><span className="hide-s">VENUE</span><span>TYPE</span><span>PRICE</span><span>SIZE</span></div>
                <AnimatePresence initial={false} mode="popLayout">
                  {rows.map((r) => (
                    <motion.div key={r.id} layout initial={{ opacity: 0, y: -14, backgroundColor: 'rgba(42,183,255,0.22)' }}
                      animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.8 }} className="kb-row">
                      <span className="muted">{clock(r.ts)}</span>
                      <span><b>{r.sym}</b></span>
                      <span className="hide-s muted">{r.venue}</span>
                      <span><em className={`status ${r.kind === 'trade' ? 's-part' : 's-new'}`}>{r.kind.toUpperCase()}</em></span>
                      <span>{r.kind === 'trade' ? fmt(r.px, r.dp) : <>{fmt(r.bid, r.dp)} <i className="muted">/</i> {fmt(r.ask, r.dp)}</>}</span>
                      <span>{r.size.toLocaleString()}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {!rows.length && <div className="kb-empty muted">waiting for events on <b>{sub}</b>…</div>}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
