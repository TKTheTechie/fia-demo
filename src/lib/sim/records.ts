import { bridgeTopic, fieldOf, headersFor } from '../../scenarios/bridge.ts'
import type { Entity, KafkaTopic, Scenario } from '../../scenarios/types.ts'

// A Kafka-style record as the sim produces it: topic + headers + a payload. The bridge turns
// topic + headers (never the payload) into a Solace topic, exactly like the broker's Kafka Receiver.

export type KRec = {
  id: number
  topic: string // flat Kafka topic, e.g. 'mktdata.quote'
  kind: string // topic with the bridge's prefix removed: 'quote'
  kindIndex: number // position of the topic in scenario.kafka.topics (picks the badge colour)
  part: number
  offset: number
  headers: Record<string, string>
  key: string
  entityId: string
  origin: string
  group: string
  value: number
  bid: number
  ask: number
  delta: number
  size: number
  dp: number
  solaceTopic: string
  ts: number
}

/** Current value of every entity; owned by the stream engine, read by records and the lifecycle. */
const values = new Map<string, number>()
export const currentValue = (e: Entity) => values.get(e.id) ?? e.value.start
export const setValue = (e: Entity, v: number) => values.set(e.id, v)

export const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
export const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

/** The Kafka topic suffix the bridge strips (e.g. 'mktdata.'), or '' if it does not strip one. */
export const topicPrefix = (sc: Scenario) => sc.kafka.bridge.segments.find((s): s is { topicSuffix: string } => 'topicSuffix' in s)?.topicSuffix ?? ''
export const kindOf = (sc: Scenario, topic: string) => topic.slice(topicPrefix(sc).length)

export const pickTopic = (sc: Scenario): { topic: KafkaTopic; index: number } => {
  let r = Math.random()
  const total = sc.kafka.topics.reduce((a, t) => a + t.weight, 0)
  r *= total
  for (const [index, topic] of sc.kafka.topics.entries()) {
    r -= topic.weight
    if (r <= 0) return { topic, index }
  }
  return { topic: sc.kafka.topics[0], index: 0 }
}

/** Build one record for `entity` on `topic` (partition and offset are the caller's business). */
export function makeRecord(sc: Scenario, entity: Entity, topic: KafkaTopic, index: number, id: number): Omit<KRec, 'offset'> & { offset: number } {
  const v = currentValue(entity) * (1 + (Math.random() - 0.5) * entity.value.volatility)
  const dp = entity.value.decimals
  const spread = v * 0.00005 + Math.pow(10, -dp)
  const headers = headersFor(topic, entity)
  const quoteLot = Number(entity.params?.quoteLot ?? 1)
  const swing = Math.max(1, Math.round(currentValue(entity) * entity.value.volatility * 4))
  return {
    id,
    topic: topic.name,
    kind: kindOf(sc, topic.name),
    kindIndex: index,
    part: hash(fieldOf(entity, topic.keyBy) ?? entity.id) % topic.partitions,
    offset: 0,
    headers,
    key: fieldOf(entity, topic.keyBy) ?? entity.id,
    entityId: entity.id,
    origin: entity.origin,
    group: entity.group,
    value: v,
    bid: v - spread / 2,
    ask: v + spread / 2,
    delta: (Math.random() < 0.6 ? -1 : 1) * Math.ceil(Math.random() * swing),
    size: Math.ceil(Math.random() * 50) * quoteLot,
    dp,
    solaceTopic: bridgeTopic(sc.kafka.bridge.segments, topic.name, headers),
    ts: Date.now(),
  }
}
