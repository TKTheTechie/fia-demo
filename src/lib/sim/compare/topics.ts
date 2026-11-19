import { topicMatches } from '../../broker.ts'
import { partitionOf } from './assign.ts'

// Act 1 model: the same event stream delivered to consumers that each want a slice of it.
// Kafka: flat topics → the consumer fetches whole topics and discards, or a router re-publishes
//        to a dedicated topic (extra hop, extra copy).  Ordering holds only within topic+partition.
// Solace: the consumer's subscriptions select events in the broker, in one in-order stream.

export type Ev = { seq: number; key: string; kafkaTopic: string; solaceTopic: string }
export type Need = { id: string; name: string; subs: string[] }
export type KafkaStrategy = 'fetch-discard' | 'republish'

export const wants = (n: Need, ev: Ev) => n.subs.some((s) => topicMatches(s, ev.solaceTopic))

export type TraceItem = { seq: number; topic: string; late: boolean }
export type Stats = { fetched: number; used: number; discarded: number; outOfOrder: number; extraCopies: number }
const blank = (): Stats => ({ fetched: 0, used: 0, discarded: 0, outOfOrder: 0, extraCopies: 0 })

export class TopicsSim {
  need: Need[] = []
  strategy = new Map<string, KafkaStrategy>()
  kafka = new Map<string, Stats>()
  solace = new Map<string, Stats>()
  private lastSeq = new Map<string, number>() // `${side}|${consumer}|${key}` → highest seq seen
  /** topics a consumer must read in Kafka to cover its need (all topics unless the need pins one) */
  /** Follow one item's events per consumer, in ARRIVAL order, flagging any that arrive after a higher sequence number. */
  traceKey?: string
  trace = new Map<string, TraceItem[]>() // `${side}|${consumer}`
  kafkaTopics: { name: string; partitions: number }[]
  constructor(kafkaTopics: { name: string; partitions: number }[]) { this.kafkaTopics = kafkaTopics }

  add(n: Need, strategy: KafkaStrategy = 'fetch-discard') {
    this.need.push(n); this.strategy.set(n.id, strategy); this.kafka.set(n.id, blank()); this.solace.set(n.id, blank())
  }
  remove(id: string) {
    this.need = this.need.filter((n) => n.id !== id)
    for (const m of [this.strategy, this.kafka, this.solace]) m.delete(id)
    this.trace.delete(`kafka|${id}`); this.trace.delete(`solace|${id}`)
  }
  setStrategy(id: string, s: KafkaStrategy) { this.strategy.set(id, s) }

  /** Kafka topics this need has to subscribe to (every topic that could hold a matching event). */
  kafkaTopicsFor(n: Need, sample: Ev[]): string[] {
    const t = new Set(sample.filter((e) => wants(n, e)).map((e) => e.kafkaTopic))
    return t.size ? [...t] : this.kafkaTopics.map((x) => x.name)
  }

  /** Deliveries produced by one published event. Order jitter is the UI's to apply before calling `arrive`. */
  publish(ev: Ev) {
    const out: { side: 'kafka' | 'solace'; consumer: string; useful: boolean; partition: number }[] = []
    const tp = this.kafkaTopics.find((t) => t.name === ev.kafkaTopic)
    const part = partitionOf(ev.key, tp?.partitions ?? 1)
    for (const n of this.need) {
      const useful = wants(n, ev)
      if (useful) out.push({ side: 'solace', consumer: n.id, useful: true, partition: -1 })
      if (this.strategy.get(n.id) === 'republish') {
        if (useful) { out.push({ side: 'kafka', consumer: n.id, useful: true, partition: part }); this.kafka.get(n.id)!.extraCopies++ }
      } else out.push({ side: 'kafka', consumer: n.id, useful, partition: part })
    }
    return out
  }

  /** Record a delivery after its (possibly jittered) arrival; counts ordering violations per entity key. */
  arrive(side: 'kafka' | 'solace', consumer: string, ev: Ev, useful: boolean) {
    const st = (side === 'kafka' ? this.kafka : this.solace).get(consumer)
    if (!st) return
    st.fetched++
    if (!useful) { st.discarded++; return }
    st.used++
    const k = `${side}|${consumer}|${ev.key}`
    const prev = this.lastSeq.get(k) ?? -1
    const late = ev.seq < prev
    if (late) st.outOfOrder++
    else this.lastSeq.set(k, ev.seq)
    if (ev.key === this.traceKey) {
      const tk = `${side}|${consumer}`
      this.trace.set(tk, [...(this.trace.get(tk) ?? []), { seq: ev.seq, topic: ev.kafkaTopic, late }].slice(-12))
    }
  }
}
