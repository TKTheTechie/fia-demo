import { useInView } from 'framer-motion'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { headersFor } from '../scenarios/bridge'
import { isPaused, scaled } from '../lib/pause'
import { useScenario } from '../lib/scenario'
import { hashKey } from '../lib/sim/compare/assign'
import { KafkaGroup, KafkaMode, MAX_PARTITIONS } from '../lib/sim/compare/kafkaGroup'
import { MAX_QUEUE_PARTITIONS, QueueType, SolaceQueue } from '../lib/sim/compare/solaceQueue'
import { Ev, KafkaStrategy, Need, TopicsSim } from '../lib/sim/compare/topics'
import { kindOf, makeRecord, pick } from '../lib/sim/records'
import type { Scenario } from '../scenarios/types'

// Kafka vs Solace — two acts. Act 1: flat topics vs topic subscriptions (what a consumer has to fetch,
// discard or re-publish, and what happens to ordering). Act 2: consumer scaling (consumer / share groups
// tied to partitions vs exclusive, non-exclusive and partitioned queues). All simulated; the logic lives
// in src/lib/sim/compare and is unit-checked by scripts/compare-selftest.mjs.

const COLORS = ['#00c895', '#4ea1ff', '#ffb547', '#c07bff', '#ff6b8a', '#5ee0e0']
const useTick = (ms: number, on: boolean) => {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => { if (!on) return; const t = window.setInterval(bump, ms); return () => clearInterval(t) }, [ms, on])
}

// ---------------------------------------------------------------------------------------------
// Act 1: topics
// ---------------------------------------------------------------------------------------------

/** Consumer "needs" generated from the scenario's bridge: pin a header level, a topic kind, or several. */
function needsFor(sc: Scenario): Need[] {
  const segs = sc.kafka.bridge.segments
  const t0 = sc.kafka.topics[0]
  const hdrs = segs.flatMap((s) => ('header' in s ? [s.header] : []))
  const hv = (h: string) => [...new Set(sc.model.entities.map((e) => headersFor(t0, e)[h]))]
  const build = (pins: Record<string, string>, kind?: string) => {
    const parts = segs.map((seg) => ('literal' in seg ? seg.literal : 'header' in seg ? pins[seg.header] ?? '*' : kind ?? '*'))
    if (kind) return parts.join('/')
    let last = -1
    segs.forEach((s, i) => { if ('header' in s && pins[s.header]) last = i })
    return `${parts.slice(0, last + 1).join('/')}/>`
  }
  const first = hdrs[0], second = hdrs[1], lastH = hdrs[hdrs.length - 1]
  const lastKind = kindOf(sc, sc.kafka.topics[sc.kafka.topics.length - 1].name)
  const regs = hv(first)
  const ent = sc.model.entities[0]
  const h0 = headersFor(t0, ent)
  const root = segs.find((s) => 'literal' in s) as { literal: string }
  return [
    { id: 'sku', name: `One ${lastH}, every event type`, subs: [build({ [lastH]: h0[lastH] })] },
    { id: 'p1', name: `${first} = ${regs[0]}`, subs: [build({ [first]: regs[0] })] },
    { id: 'kind', name: `Only “${lastKind}” events`, subs: [build({}, lastKind)] },
    { id: 'p2', name: `${second} = ${h0[second]}`, subs: [build({ [first]: h0[first], [second]: h0[second] })] },
    { id: 'multi', name: `${first} ${regs[0]} + ${regs[1] ?? regs[0]}`, subs: [build({ [first]: regs[0] }), build({ [first]: regs[1] ?? regs[0] })] },
    { id: 'all', name: 'Everything (analytics)', subs: [`${root.literal}/>`] },
  ]
}

function Trace({ side, items, label }: { side: 'kafka' | 'solace'; items: { seq: number; topic: string; late: boolean }[]; label: string }) {
  const kinds = [...new Set(items.map((i) => i.topic))]
  return (
    <div className="cmp-trace mono" data-trace={side}>
      <label>{label}</label>
      <div className="cmp-tchips">
        {items.map((t, i) => (
          <span key={`${t.seq}-${i}`} className={`${t.late ? 'late' : ''} k${kinds.indexOf(t.topic) % 3}`} title={`${t.topic} · seq ${t.seq}${t.late ? ' — arrived after a higher sequence number' : ''}`}>
            #{t.seq % 1000}{t.late && <em> late</em>}
          </span>
        ))}
        {!items.length && <span className="cmp-hint">waiting for events…</span>}
      </div>
    </div>
  )
}

export function TopicsAct() {
  const sc = useScenario()
  const palette = useMemo(() => needsFor(sc), [sc])
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-80px' })
  const sim = useRef<TopicsSim>()
  if (!sim.current) {
    sim.current = new TopicsSim(sc.kafka.topics.map((t) => ({ name: t.name, partitions: t.partitions })))
    for (const id of ['sku', 'p1', 'kind']) sim.current.add(palette.find((n) => n.id === id)!)
  }
  const s = sim.current
  const sample = useRef<Ev[]>([])
  const seq = useRef(0)
  const hotTurn = useRef(0)
  const rate = useRef({ published: 0, wanted: 0 })
  useTick(250, inView)

  useEffect(() => {
    if (!inView) return
    let t = 0
    const loop = () => {
      if (isPaused()) { t = window.setTimeout(loop, 200); return }
      // One "hot" item keeps emitting both event types so the cross-topic ordering problem shows up within seconds.
      const hot = sc.model.entities[0]
      s.traceKey = hot.id
      const isHot = Math.random() < 0.6
      const kt = isHot ? sc.kafka.topics[hotTurn.current++ % sc.kafka.topics.length] : pick(sc.kafka.topics)
      const rec = makeRecord(sc, isHot ? hot : pick(sc.model.entities), kt, sc.kafka.topics.indexOf(kt), seq.current)
      const ev: Ev = { seq: seq.current++, key: rec.entityId, kafkaTopic: rec.topic, solaceTopic: rec.solaceTopic }
      sample.current = [...sample.current, ev].slice(-300)
      rate.current.published++
      for (const d of s.publish(ev)) {
        // Kafka: each (topic, partition) has its own lag, so records from different partitions/topics interleave.
        // Solace: one ordered stream per consumer.
        const lag = d.side === 'kafka' ? 30 + (hashKey(`${ev.kafkaTopic}${d.partition}`) % 700) + Math.random() * 250 + (s.strategy.get(d.consumer) === 'republish' ? 140 : 0) : 40
        window.setTimeout(() => s.arrive(d.side, d.consumer, ev, d.useful), scaled(lag))
      }
      t = window.setTimeout(loop, scaled(160 + Math.random() * 120))
    }
    loop()
    return () => clearTimeout(t)
  }, [inView, sc, s])

  const tot = (m: Map<string, { fetched: number; used: number; discarded: number; outOfOrder: number; extraCopies: number }>) =>
    [...m.values()].reduce((a, x) => ({ fetched: a.fetched + x.fetched, used: a.used + x.used, discarded: a.discarded + x.discarded, outOfOrder: a.outOfOrder + x.outOfOrder, extraCopies: a.extraCopies + x.extraCopies }), { fetched: 0, used: 0, discarded: 0, outOfOrder: 0, extraCopies: 0 })
  const K = tot(s.kafka), S = tot(s.solace)
  const waste = (x: typeof K) => (x.fetched ? Math.round((x.discarded / x.fetched) * 100) : 0)
  const extraTopics = [...s.strategy.values()].filter((v) => v === 'republish').length

  return (
    <div ref={ref} className="cmp-act" data-act="topics">
      <div className="cmp-add mono" data-add-consumer>
        <label>ADD CONSUMER</label>
        {palette.map((n) => {
          const on = s.need.some((x) => x.id === n.id)
          return <button key={n.id} data-need={n.id} className={`chip ${on ? 'on' : ''}`} onClick={() => (on ? s.remove(n.id) : s.add(n))}>{on ? '✓ ' : '+ '}{n.name}</button>
        })}
      </div>
      <div className="cmp-cols">
        <div className="cmp-side kafka panel" data-side="kafka" style={{ gridRow: `span ${s.need.length + 2}` }}>
          <div className="cmp-phead">
          <h4>Apache Kafka <small>flat topics</small></h4>
          <div className="cmp-sum mono"><span>fetched <b>{K.fetched}</b></span><span>discarded <b className="bad" data-k-waste>{waste(K)}%</b></span><span>extra topics <b>{extraTopics}</b></span><span>out of order <b className="bad" data-k-ooo>{K.outOfOrder}</b></span></div>
          </div>
          {s.need.map((n, i) => {
            const st = s.kafka.get(n.id)!
            const strat = s.strategy.get(n.id)!
            const topics = s.kafkaTopicsFor(n, sample.current)
            return (
              <div key={n.id} className="cmp-card" data-consumer={n.id}>
                <div className="cmp-ch"><i style={{ background: COLORS[i % COLORS.length] }} /><b>{n.name}</b><button className="x" aria-label="Remove" onClick={() => s.remove(n.id)}>×</button></div>
                <div className="cmp-sub mono">{strat === 'republish' ? `router → ${n.id}.in (own topic, own copy)` : `subscribes ${topics.join(' + ')} — whole topic`}</div>
                {strat === 'republish' && (
                  <div className="cmp-lane mono" data-router>
                    {topics.map((t) => <span key={t}>{t}</span>)}<i>→</i><b>router app</b><i>merges in arrival order →</i><span>{n.id}.in</span>
                  </div>
                )}
                {n.id === 'sku' && <Trace side="kafka" items={s.trace.get(`kafka|${n.id}`) ?? []} label={strat === 'republish' ? `ROUTER OUTPUT · ${s.traceKey}` : `ARRIVAL ORDER · ${s.traceKey}`} />}
                <div className="cmp-bar"><i className="used" style={{ width: `${st.fetched ? (st.used / st.fetched) * 100 : 0}%` }} /><i className="waste" style={{ width: `${st.fetched ? (st.discarded / st.fetched) * 100 : 0}%` }} /></div>
                <div className="cmp-num mono"><span>used {st.used}</span><span className="bad">discarded {st.discarded}</span><span className={st.outOfOrder ? 'bad' : ''}>out-of-order {st.outOfOrder}</span></div>
                <div className="cmp-seg mono">
                  {(['fetch-discard', 'republish'] as KafkaStrategy[]).map((v) => (
                    <button key={v} data-strategy={v} className={strat === v ? 'on' : ''} onClick={() => s.setStrategy(n.id, v)}>{v === 'fetch-discard' ? 'fetch & discard' : 're-publish'}</button>
                  ))}
                </div>
              </div>
            )
          })}
          <p className="cmp-note">Kafka can only order within one topic + partition. A consumer that needs events from several topics merges them itself, so one item’s events can arrive out of order.</p>
        </div>
        <div className="cmp-side solace panel" data-side="solace" style={{ gridRow: `span ${s.need.length + 2}` }}>
          <div className="cmp-phead">
          <h4>Solace <small>topic subscriptions</small></h4>
          <div className="cmp-sum mono"><span>delivered <b>{S.fetched}</b></span><span>discarded <b className="good" data-s-waste>{waste(S)}%</b></span><span>extra topics <b>0</b></span><span>out of order <b className="good" data-s-ooo>{S.outOfOrder}</b></span></div>
          </div>
          {s.need.map((n, i) => {
            const st = s.solace.get(n.id)!
            return (
              <div key={n.id} className="cmp-card" data-consumer={n.id}>
                <div className="cmp-ch"><i style={{ background: COLORS[i % COLORS.length] }} /><b>{n.name}</b></div>
                <div className="cmp-sub mono">{n.subs.map((x) => <code key={x}>{x}</code>)}</div>
                {n.id === 'sku' && <Trace side="solace" items={s.trace.get(`solace|${n.id}`) ?? []} label={`ARRIVAL ORDER · ${s.traceKey}`} />}
                <div className="cmp-bar"><i className="used" style={{ width: '100%' }} /></div>
                <div className="cmp-num mono"><span>delivered {st.used}</span><span className="good">discarded 0</span><span className="good">out-of-order {st.outOfOrder}</span></div>
              </div>
            )
          })}
          <p className="cmp-note">No topics or partitions to provision. The broker matches each subscription and delivers one in-order stream — across every topic that matches.</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Act 2: consumer scaling
// ---------------------------------------------------------------------------------------------

type Rec = { seq: number; key: string; hdr: Record<string, string> }
type Counters = { processed: number; ooo: number; lost: number; discarded: number }
type Pin = { h: string; v: string } | null
const matches = (pin: Pin, r: Rec) => !pin || r.hdr[pin.h] === pin.v
/** Apps you can add (each is one Kafka consumer group + one Solace queue) and the queue type it starts with. */
const CATALOG: { name: string; type: QueueType }[] = [
  { name: 'Fulfilment', type: 'partitioned' },
  { name: 'Fraud screen', type: 'non-exclusive' },
  { name: 'Audit', type: 'exclusive' },
  { name: 'Analytics', type: 'non-exclusive' },
  { name: 'Search index', type: 'partitioned' },
  { name: 'Notifications', type: 'exclusive' },
]
const DEFAULT_APPS = CATALOG.slice(0, 3).map((a) => a.name)
const newKApp = (name: string, parts: number, mode: KafkaMode, now: number): KApp => {
  const g = new KafkaGroup(parts, 1)
  if (mode !== 'classic') g.setMode(mode, now)
  return { name, g, q: Array.from({ length: parts }, () => []), lag: new Lag(), lastBy: {} }
}
const newSApp = (name: string): SApp => {
  const type = CATALOG.find((a) => a.name === name)?.type ?? 'partitioned'
  const q = new SolaceQueue(name.split(' ')[0].toLowerCase(), type, 4, 1)
  return { name, q, qs: Array.from({ length: type === 'partitioned' ? 4 : 1 }, () => []), lag: new Lag(), held: [] }
}
const TICK = 100
const PER_TICK = 3 // events published per tick (30/s); each consumer handles 1 per tick (10/s)

class Lag { last = new Map<string, number>(); c: Counters = { processed: 0, ooo: 0, lost: 0, discarded: 0 }
  done(r: Rec) { const p = this.last.get(r.key) ?? -1; this.c.processed++; if (r.seq < p) this.c.ooo++; else this.last.set(r.key, r.seq) } }

type KApp = { name: string; g: KafkaGroup; q: Rec[][]; lag: Lag; lastBy: Record<number, string> }
type SApp = { name: string; q: SolaceQueue; qs: Rec[][]; lag: Lag; pending?: number; held: Rec[] }
const backlog = (qs: Rec[][]) => qs.reduce((x, q) => x + q.length, 0)
/** Apply a new partition count to the queue's storage. Messages in removed partitions are lost (as on a real broker). */
function applyResize(a: SApp, target: number, now: number) {
  if (!a.q.setPartitions(target, now)) return
  while (a.qs.length < target) a.qs.push([])
  while (a.qs.length > target) a.lag.c.lost += a.qs.pop()!.length
}

export function ScalingAct() {
  const sc = useScenario()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-80px' })
  // The partitioning strategy: which header/field is the key. Kafka hashes the record key; Solace hashes the
  // same value taken from a level of the topic. Same strategy on both sides, so the comparison is fair.
  const t0 = sc.kafka.topics[0]
  const keyOpts = Object.keys(t0.headers)
  const [keyHeader, setKeyHeader] = useState(() => keyOpts.find((h) => t0.headers[h] === 'origin') ?? keyOpts[0])
  const keys = useMemo(() => [...new Set(sc.model.entities.map((e) => headersFor(t0, e)[keyHeader]))], [sc, t0, keyHeader])
  const segs = sc.kafka.bridge.segments
  const keyLevel = segs.findIndex((x) => 'header' in x && x.header === keyHeader) + 1
  const subscription = `${segs.slice(0, Math.max(0, segs.findIndex((x) => !('literal' in x)))).map((x) => ('literal' in x ? x.literal : '')).join('/')}/>`
  const viewOpts = useMemo(() => {
    const h = headersFor(t0, sc.model.entities[0])
    const [h1, h2] = keyOpts
    return [{ label: 'all events', pin: null as Pin }, { label: `${h1} = ${h[h1]}`, pin: { h: h1, v: h[h1] } as Pin }, { label: `${h2} = ${h[h2]}`, pin: { h: h2, v: h[h2] } as Pin }]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc, t0])
  const pinOf = (app: string) => viewOpts[viewRef.current[app] ?? 0].pin
  const viewSub = (pin: Pin) => {
    if (!pin) return subscription
    const parts = segs.map((x) => ('literal' in x ? x.literal : 'header' in x ? (x.header === pin.h ? pin.v : '*') : '*'))
    const last = segs.findIndex((x) => 'header' in x && x.header === pin.h)
    return `${parts.slice(0, last + 1).join('/')}/>`
  }
  const now = useRef(0), seq = useRef(0), tickN = useRef(0), burst = useRef(0)
  const [mode, setModeState] = useState<KafkaMode>('classic')
  // Each app can want a different VIEW of the stream (all of it, one region, one store).
  const [views, setViews] = useState<Record<string, number>>({}) // app → index into viewOpts (0 = all)
  const [routes, setRoutes] = useState<Record<string, 'discard' | 'topic'>>({}) // Kafka: how an app gets its view
  const viewRef = useRef<Record<string, number>>({}), routeRef = useRef<Record<string, 'discard' | 'topic'>>({})
  const [drain, setDrain] = useState(true)
  const drainRef = useRef(true)
  const [note, setNote] = useState<{ k?: string; s?: string; kw?: string }>({})
  const mk = (names: string[] = DEFAULT_APPS) => ({ kafka: names.map((n) => newKApp(n, 4, 'classic', 0)), solace: names.map(newSApp), partitions: 4 })
  const st = useRef(mk())
  useTick(200, inView)

  // Banners are transient: each clears itself a few seconds after it last changed.
  useEffect(() => {
    const ts = (['k', 's', 'kw'] as const).filter((k) => note[k]).map((k) => {
      const v = note[k]
      return window.setTimeout(() => setNote((n) => (n[k] === v ? { ...n, [k]: undefined } : n)), 5000)
    })
    return () => ts.forEach(clearTimeout)
  }, [note])

  const kRebalance = (r?: { stalled: number[]; ms: number; stopTheWorld: boolean; reason: string }) => {
    if (r) setNote((n) => ({ ...n, k: r.stopTheWorld ? `STOP THE WORLD — ${r.reason}: all ${r.stalled.length} partitions paused ${(r.ms / 1000).toFixed(1)}s` : `${r.reason}: only partition${r.stalled.length > 1 ? 's' : ''} ${r.stalled.join(', ')} paused ${(r.ms / 1000).toFixed(1)}s` }))
  }
  const sHandoff = (name: string, h?: { moved: number[]; reason: string; ms: number }) => {
    if (h) setNote((n) => ({ ...n, s: `${name}: ${h.reason} — only partition${h.moved.length > 1 ? 's' : ''} ${h.moved.join(', ')} handed off; the rest keep flowing` }))
  }

  useEffect(() => {
    if (!inView) return
    let t = 0
    const loop = () => {
      t = window.setTimeout(loop, scaled(TICK))
      if (isPaused()) return
      now.current += TICK
      tickN.current++
      const S = st.current, n = now.current
      const rate = PER_TICK + (burst.current > n ? 6 : 0)
      for (let i = 0; i < rate; i++) {
        const ent = pick(sc.model.entities); const hdr = headersFor(t0, ent)
        const r: Rec = { seq: seq.current++, key: hdr[keyHeader], hdr }
        for (const a of S.kafka) {
          // own-topic routing: a router app copies only the app's slice into a dedicated topic; otherwise the group reads everything
          if (routeRef.current[a.name] === 'topic' && !matches(pinOf(a.name), r)) continue
          a.q[a.g.partitionFor(r.key)]?.push(r)
        }
        for (const a of S.solace) {
          if (!matches(pinOf(a.name), r)) continue // the broker filters: non-matching events are never queued
          if (a.pending !== undefined) a.held.push(r) // ingress paused while the queue drains
          else if (a.q.type === 'partitioned') a.qs[hashKey(r.key) % a.q.partitions]?.push(r)
          else a.qs[0].push(r)
        }
      }
      // Kafka groups
      for (const a of S.kafka) {
        const g = a.g
        g.consumers.forEach((c) => {
          let p = -1
          if (g.mode === 'share') {
            let best = 0
            a.q.forEach((q, i) => { if (q.length > best) { best = q.length; p = i } })
          } else {
            const mine = a.q.map((_, i) => i).filter((i) => g.assignment[i] === c && g.owner(i, n) === c && a.q[i].length)
            if (mine.length) p = mine[tickN.current % mine.length]
          }
          if (g.mode === 'share' && p >= 0) a.lastBy[p] = c // share groups have no owner; colour a partition by the consumer that last took from it
          if (p < 0) return
          const q = a.q[p]
          const idx = g.mode === 'share' ? Math.floor(Math.random() * Math.min(q.length, g.consumers.length)) : 0
          const rec = q.splice(idx, 1)[0]
          if (matches(pinOf(a.name), rec)) a.lag.done(rec); else a.lag.c.discarded++ // fetched, then thrown away — still cost a slot
        })
      }
      // Solace queues
      for (const a of S.solace) {
        const q = a.q
        if (a.pending !== undefined && (backlog(a.qs) === 0 || !q.consumers.length)) {
          applyResize(a, a.pending, n); a.pending = undefined
          a.held.forEach((r) => a.qs[hashKey(r.key) % q.partitions].push(r)); a.held = []
        }
        if (q.type === 'exclusive') { const r = a.qs[0].shift(); if (r && q.consumers.length) a.lag.done(r) }
        else if (q.type === 'non-exclusive') {
          for (let i = 0; i < q.consumers.length && a.qs[0].length; i++) a.lag.done(a.qs[0].splice(Math.floor(Math.random() * Math.min(a.qs[0].length, q.consumers.length)), 1)[0])
        } else {
          q.consumers.forEach((c) => {
            const mine = a.qs.map((_, i) => i).filter((i) => q.assignment[i] === c && q.stalledUntil[i] <= n && a.qs[i].length)
            if (mine.length) a.lag.done(a.qs[mine[tickN.current % mine.length]].shift()!)
          })
        }
      }
    }
    loop()
    return () => clearTimeout(t)
  }, [inView, keys])

  const S = st.current
  const n = now.current
  const setMode = (m: KafkaMode) => { S.kafka.forEach((a) => a.g.setMode(m, n)); setModeState(m); setNote((x) => ({ ...x, k: undefined })) }
  const addPart = () => {
    if (S.partitions >= MAX_PARTITIONS) return
    let remap = 0
    for (const a of S.kafka) { const r = a.g.addPartition(n, keys); a.q.push([]); if (r) { remap = r.remapped; kRebalance(r.rebalance) } }
    S.partitions++
    setNote((x) => ({ ...x, kw: `Partition added: ${Math.round(remap * 100)}% of keys now hash to a different partition — per-key ordering breaks across the change.` }))
  }
  const setView = (app: string, i: number) => { viewRef.current = { ...viewRef.current, [app]: i }; setViews(viewRef.current) }
  const setRoute = (app: string, r: 'discard' | 'topic') => { routeRef.current = { ...routeRef.current, [app]: r }; setRoutes(routeRef.current) }
  const clearViews = () => { viewRef.current = {}; routeRef.current = {}; setViews({}); setRoutes({}) }
  const viewBar = (app: string, attr: string) => (
    <div className="cmp-seg mono" data-viewbar={attr}>
      <label>VIEW</label>
      {viewOpts.map((o, i) => <button key={o.label} data-view={attr} data-i={i} className={(views[app] ?? 0) === i ? 'on' : ''} onClick={() => setView(app, i)}>{o.label}</button>)}
    </div>
  )
  const pickKey = (h: string) => { setKeyHeader(h); st.current = mk(st.current.kafka.map((a) => a.name)); setModeState('classic'); setNote({}); now.current = 0; drainRef.current = true; setDrain(true) }
  const hasApp = (name: string) => S.kafka.some((a) => a.name === name)
  const addApp = (name: string) => { if (hasApp(name)) return; S.kafka.push(newKApp(name, S.partitions, mode, n)); S.solace.push(newSApp(name)) }
  const removeApp = (name: string) => {
    if (S.kafka.length <= 1) return
    S.kafka = S.kafka.filter((a) => a.name !== name); S.solace = S.solace.filter((a) => a.name !== name)
    delete viewRef.current[name]; delete routeRef.current[name]; setViews({ ...viewRef.current }); setRoutes({ ...routeRef.current })
  }
  const reset = () => { clearViews(); st.current = mk(); setModeState('classic'); setNote({}); now.current = 0; drainRef.current = true; setDrain(true) }
  const crash = () => {
    S.kafka.forEach((a) => { const r = a.g.removeConsumer(n).rebalance; if (r) kRebalance(r) })
    S.solace.forEach((a) => { const r = a.q.removeConsumer(n); sHandoff(a.name, r.handoff) })
  }
  const solRemainder = (a: SApp, parts: number) => { // re-bucket leftovers when the queue shape changes
    const left = a.qs.flat().sort((x, y) => x.seq - y.seq)
    a.qs = Array.from({ length: parts }, () => [])
    left.forEach((r) => a.qs[parts === 1 ? 0 : hashKey(r.key) % parts].push(r))
  }
  const resize = (a: SApp, target: number) => {
    target = Math.max(1, Math.min(MAX_QUEUE_PARTITIONS, target))
    if (target === (a.pending ?? a.q.partitions)) return
    if (drainRef.current) { a.pending = target; setNote((x) => ({ ...x, s: `${a.name}: resizing to ${target} partitions — publisher ingress paused while the queue drains, then the new count applies` })) }
    else { applyResize(a, target, n); setNote((x) => ({ ...x, s: `${a.name}: resized to ${target} without draining — keys remapped while old messages are still queued` })) }
  }
  // One scale for every partition on the tab, so fills are comparable across apps and sides.
  // Partition cells scale against the largest single partition; a whole (unpartitioned) queue scales against the largest queue.
  const scale = Math.max(20, ...S.kafka.flatMap((a) => a.q.map((x) => x.length)), ...S.solace.filter((a) => a.q.type === 'partitioned').flatMap((a) => a.qs.map((x) => x.length)))
  const qScale = Math.max(20, ...S.solace.filter((a) => a.q.type !== 'partitioned').map((a) => backlog(a.qs)))
  const cell = (owner: string | null | undefined, consumers: string[], stalled: boolean, backlogN: number, label: string) => {
    const ci = owner ? consumers.indexOf(owner) : -1
    return (
      <div key={label} className={`cmp-cell ${stalled ? 'stalled' : ''}`} style={{ borderColor: ci >= 0 ? COLORS[ci % COLORS.length] : undefined }} title={`${label} · backlog ${backlogN} (full = ${scale})`}>
        <span>{label}</span>
        <i style={{ height: `${(backlogN / scale) * 100}%`, background: ci >= 0 ? COLORS[ci % COLORS.length] : 'var(--muted)' }} />
        <u>{backlogN}</u>
        {stalled && <em>⏸</em>}
      </div>
    )
  }

  return (
    <div ref={ref} className="cmp-act" data-act="scaling">
      <div className="cmp-add mono">
        <label>WORKLOAD</label>
        <button className="chip" data-preset="burst" onClick={() => (burst.current = now.current + 8000)}>⚡ Black Friday burst</button>
        <button className="chip" data-preset="crash" onClick={crash}>💥 A consumer crashes (every app)</button>
        <button className="chip" data-preset="reset" onClick={reset}>↺ Reset</button>
        <span className="cmp-hint">each consumer handles 10 msg/s · the stream is 30 msg/s</span>
      </div>
      <div className="cmp-add mono" data-addapp>
        <label>APPS</label>
        {CATALOG.map((c) => {
          const on = hasApp(c.name)
          return <button key={c.name} data-app={c.name} className={`chip ${on ? 'on' : ''}`} disabled={on && S.kafka.length <= 1} onClick={() => (on ? removeApp(c.name) : addApp(c.name))}>{on ? '✓ ' : '+ '}{c.name}</button>
        })}
        <span className="cmp-hint">each app = a Kafka consumer group + a Solace queue</span>
      </div>
      <div className="cmp-add mono" data-keybar>
        <label>PARTITION KEY</label>
        {keyOpts.map((h) => <button key={h} data-key2={h} className={`chip ${h === keyHeader ? 'on' : ''}`} onClick={() => pickKey(h)}>{h}</button>)}
        <span className="cmp-hint">{keys.length} distinct {keyHeader} values · a key is the unit of ordering — and of parallelism</span>
      </div>
      <div className="cmp-cols">
        <div className="cmp-side kafka panel" data-side="kafka" style={{ gridRow: `span ${S.kafka.length + 2}` }}>
          <div className="cmp-phead">
          <h4>Apache Kafka <small>one topic · a consumer group per app</small></h4>
          <div className="cmp-strat mono" data-kafka-strategy>
            <label>TOPIC &amp; KEY</label>
            <span className="pill">topic <b>{t0.name}</b></span>
            <span className="pill">key <b>{keyHeader}</b></span>
            <span className="pill">partition = <b>hash({keyHeader}) % {S.partitions}</b></span>
          </div>
          <div className="cmp-ctl mono">
            <label>GROUP PROTOCOL</label>
            {([['classic', 'classic (eager)'], ['kip848', 'KIP-848 incremental'], ['share', 'share group (KIP-932)']] as [KafkaMode, string][]).map(([m, l]) => (
              <button key={m} data-mode={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{l}</button>
            ))}
          </div>
          <div className="cmp-ctl mono">
            <label>PARTITIONS</label>
            <button className="chip" disabled title="Kafka cannot reduce a topic's partition count — you must create a new topic and migrate." data-kparts="dec">−</button>
            <b data-kparts-n>{S.partitions}</b>
            <button className="chip" data-kparts="inc" disabled={S.partitions >= MAX_PARTITIONS} onClick={addPart}>+</button>
            <span className="cmp-hint">partitions can only be added, never removed</span>
          </div>
          {note.kw && <div className="cmp-warn mono">{note.kw}</div>}
          {note.k && <div className={`cmp-toast mono ${note.k.startsWith('STOP') ? 'bad' : ''}`} data-k-note>{note.k}</div>}
          </div>
          {S.kafka.map((a) => {
            const g = a.g
            const idle = g.idleConsumers().length
            return (
              <div key={a.name} className="cmp-card" data-kapp={a.name}>
                <div className="cmp-ch"><b>{a.name}</b><span className="mono">group · {g.consumers.length} consumer{g.consumers.length === 1 ? '' : 's'}</span>
                  <span className="cmp-btns"><button data-remove-app="kafka" aria-label="Remove app" title="Remove this app" disabled={S.kafka.length <= 1} onClick={() => removeApp(a.name)}>×</button><button data-kc="dec" onClick={() => kRebalance(g.removeConsumer(n).rebalance)} disabled={!g.consumers.length}>−</button><button data-kc="inc" onClick={() => kRebalance(g.addConsumer(n).rebalance)}>+</button></span></div>
                {(() => {
                  const pin = viewOpts[views[a.name] ?? 0].pin, route = routes[a.name] ?? 'discard'
                  return (
                    <>
                      <div className="cmp-sub mono">{pin && route === 'topic' ? <span data-extra-topic>router app copies the slice into <code>{a.name.split(' ')[0].toLowerCase()}.in</code> · reads <code>{t0.name}</code> in full</span> : <>reads <code>{t0.name}</code> · all {a.q.length} partitions · {pin ? 'every record, then discards the rest' : 'no filtering needed'}</>}</div>
                      {viewBar(a.name, 'kafka')}
                      {pin && <div className="cmp-seg mono" data-routebar><label>HOW</label>{(['discard', 'topic'] as const).map((r) => <button key={r} data-route={r} className={route === r ? 'on' : ''} onClick={() => setRoute(a.name, r)}>{r === 'discard' ? 'fetch & discard' : 'own topic + router'}</button>)}</div>}
                    </>
                  )
                })()}
                <div className="cmp-cells">{a.q.map((q, p) => cell(g.mode === 'share' ? a.lastBy[p] : g.assignment[p], g.consumers, g.stalledUntil[p] > n, q.length, `P${p}`))}</div>
                <div className="cmp-legend mono" data-klegend>{g.consumers.map((c, ci) => <span key={c}><i style={{ background: COLORS[ci % COLORS.length] }} />{c}</span>)}{g.mode === 'share' && <em>any consumer can take any partition · colour = last consumer to take from it</em>}</div>
                <div className="cmp-num mono"><span>backlog {backlog(a.q)}</span><span>done {a.lag.c.processed}</span><span className={a.lag.c.ooo ? 'bad' : ''}>out-of-order {a.lag.c.ooo}</span>{a.lag.c.discarded > 0 && <span className="bad" data-kdiscard>discarded {a.lag.c.discarded}</span>}{idle > 0 && <span className="bad" data-idle>{idle} idle (no partition)</span>}</div>
              </div>
            )
          })}
          <p className="cmp-note">Consumers and partitions are coupled: more consumers than partitions just sit idle (unless you move to a share group — which gives up per-key ordering).</p>
        </div>
        <div className="cmp-side solace panel" data-side="solace" style={{ gridRow: `span ${S.kafka.length + 2}` }}>
          <div className="cmp-phead">
          <h4>Solace <small>one queue per app · choose its type</small></h4>
          <div className="cmp-ctl mono"><label>RESIZE PARTITIONS</label>
            <button className={`chip ${drain ? 'on' : ''}`} data-drain onClick={() => { drainRef.current = !drain; setDrain(!drain) }}>{drain ? '✓ drain first (recommended)' : 'no drain — scale live'}</button></div>
          {note.s && <div className="cmp-toast good mono" data-s-note>{note.s}</div>}
          </div>
          {S.solace.map((a) => {
            const q = a.q
            return (
              <div key={a.name} className="cmp-card" data-sapp={a.name}>
                <div className="cmp-ch"><b>{a.name}</b><span className="mono">{q.consumers.length} consumer{q.consumers.length === 1 ? '' : 's'}</span>
                  <span className="cmp-btns"><button data-remove-app="solace" aria-label="Remove app" title="Remove this app" disabled={S.solace.length <= 1} onClick={() => removeApp(a.name)}>×</button><button data-sc="dec" onClick={() => sHandoff(a.name, q.removeConsumer(n).handoff)} disabled={!q.consumers.length}>−</button><button data-sc="inc" onClick={() => sHandoff(a.name, q.addConsumer(n).handoff)}>+</button></span></div>
                <div className="cmp-sub mono" data-solace-strategy>subscribes <code data-ssub>{viewSub(viewOpts[views[a.name] ?? 0].pin)}</code>{q.type === 'partitioned' ? <> · key <b>{keyHeader}</b> = topic level {keyLevel} · partition = <b>hash({keyHeader}) % {q.partitions}</b></> : <> · no partition key{q.type === 'exclusive' ? ' (one active consumer keeps order)' : ' (round-robin)'}</>}</div>
                {viewBar(a.name, 'solace')}
                <div className="cmp-seg mono">
                  {(['exclusive', 'non-exclusive', 'partitioned'] as QueueType[]).map((t) => (
                    <button key={t} data-qtype={t} className={q.type === t ? 'on' : ''} onClick={() => { q.setType(t, n); a.pending = undefined; solRemainder(a, t === 'partitioned' ? q.partitions : 1); a.held.forEach((r) => a.qs[t === 'partitioned' ? hashKey(r.key) % q.partitions : 0].push(r)); a.held = []; a.lag.last.clear() }}>{t}</button>
                  ))}
                </div>
                {q.type === 'partitioned' ? (
                  <>
                    <div className="cmp-ctl mono"><label>PARTITIONS</label>
                      <button className="chip" data-sparts="dec" disabled={(a.pending ?? q.partitions) <= 1} onClick={() => resize(a, (a.pending ?? q.partitions) - 1)}>−</button>
                      <b data-sparts-n>{a.pending ?? q.partitions}</b>
                      <button className="chip" data-sparts="inc" disabled={(a.pending ?? q.partitions) >= MAX_QUEUE_PARTITIONS} onClick={() => resize(a, (a.pending ?? q.partitions) + 1)}>+</button>
                      <span className="cmp-hint">changing the count is service-affecting</span></div>
                    {a.pending !== undefined && <div className="cmp-warn mono" data-draining>draining · ingress paused · {a.held.length} held · {backlog(a.qs)} left to drain</div>}
                    <div className="cmp-cells">{a.qs.map((x, p) => cell(q.assignment[p], q.consumers, q.stalledUntil[p] > n, x.length, `P${p}`))}</div>
                  </>
                ) : (
                  <div className="cmp-cells">
                    <div className="cmp-cell qcell" title={`queue · backlog ${backlog(a.qs)} (full = ${qScale})`}>
                      <span>queue</span><i style={{ height: `${(backlog(a.qs) / qScale) * 100}%`, background: 'var(--muted)' }} /><u>{backlog(a.qs)}</u></div>
                    {q.consumers.map((c, ci) => (
                    <div key={c} className={`cmp-cell ${q.type === 'exclusive' && ci > 0 ? 'standby' : ''}`} style={{ borderColor: COLORS[ci % COLORS.length] }} title={c}>
                      <span>{q.type === 'exclusive' ? (ci === 0 ? 'active' : 'standby') : `c${ci + 1}`}</span></div>
                  ))}{!q.consumers.length && <span className="cmp-hint">no consumers</span>}</div>
                )}
                <div className="cmp-num mono"><span>backlog {backlog(a.qs)}</span><span>done {a.lag.c.processed}</span>
                  <span className={a.lag.c.ooo ? 'bad' : 'good'}>{q.type === 'non-exclusive' ? 'round-robin · ' : ''}out-of-order {a.lag.c.ooo}</span>
                  {a.lag.c.lost > 0 && <span className="bad">lost {a.lag.c.lost}</span>}</div>
              </div>
            )
          })}
          <p className="cmp-note">Each app picks the queue type it needs. Adding consumers never touches other apps, and a partitioned queue only pauses the partitions that change hands.</p>
        </div>
      </div>
    </div>
  )
}
