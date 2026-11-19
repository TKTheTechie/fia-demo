import type { BridgeSegment, Entity, FieldRef, KafkaTopic, Scenario } from './types.ts'

/** Value of a built-in field or `attrs.<name>` for an entity (undefined if the attr is missing). */
export function fieldOf(entity: Entity, ref: FieldRef): string | undefined {
  return ref.startsWith('attrs.') ? entity.attrs?.[ref.slice(6)] : entity[ref as 'id' | 'group' | 'origin']
}

/** Header values a producer would set for `entity` on `topic`. */
export function headersFor(topic: KafkaTopic, entity: Entity): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, ref] of Object.entries(topic.headers)) {
    const v = fieldOf(entity, ref)
    if (v === undefined) throw new Error(`entity "${entity.id}" has no value for ${ref} (needed by header "${name}" on ${topic.name})`)
    out[name] = v
  }
  return out
}

/**
 * What the in-browser demo does in sim mode: build the Solace topic from ONLY the Kafka topic
 * name and the record headers (never the payload), exactly like the broker's Kafka Receiver.
 */
export function bridgeTopic(segments: BridgeSegment[], kafkaTopic: string, headers: Record<string, string>): string {
  return segments
    .map((s) => {
      if ('literal' in s) return s.literal
      if ('header' in s) {
        const v = headers[s.header]
        if (v === undefined) throw new Error(`bridge needs header "${s.header}" but the record has none`)
        return v
      }
      if (!kafkaTopic.startsWith(s.topicSuffix)) throw new Error(`kafka topic "${kafkaTopic}" does not start with "${s.topicSuffix}"`)
      return kafkaTopic.slice(s.topicSuffix.length)
    })
    .join('/')
}

/**
 * The Kafka Receiver "local topic" substitution expression for the same segments, for pasting
 * into Broker Manager (or applying through SEMP in live mode, later).
 *
 * UNVERIFIED against a real broker: the header form `kafkaHeaderAsString()` comes from a Solace
 * Community thread, and `replace()` is assumed to be a literal (non-regex) replace like the docs
 * example `${replace(kafkaTopic(),".","/")}`. Check both before relying on this.
 */
export function bridgeExpression(segments: BridgeSegment[]): string {
  return segments
    .map((s) => {
      if ('literal' in s) return s.literal
      if ('header' in s) return `\${kafkaHeaderAsString("${s.header}")}`
      return `\${replace(kafkaTopic(),"${s.topicSuffix}","")}`
    })
    .join('/')
}

/** Every Solace topic the Kafka->bridge path can produce for this scenario. */
export function streamTopics(sc: Scenario): string[] {
  const out = new Set<string>()
  for (const t of sc.kafka.topics)
    for (const e of sc.model.entities) out.add(bridgeTopic(sc.kafka.bridge.segments, t.name, headersFor(t, e)))
  return [...out]
}

/** Every topic the lifecycle can publish (stage x facet values x entity). */
export function lifecycleTopics(sc: Scenario): string[] {
  const { pattern, facets, stages } = sc.lifecycle
  const out = new Set<string>()
  const keys = Object.keys(facets)
  const combos = (i: number, acc: Record<string, string>): Record<string, string>[] =>
    i === keys.length ? [acc] : facets[keys[i]].flatMap((v) => combos(i + 1, { ...acc, [keys[i]]: v }))
  for (const st of stages)
    for (const f of combos(0, {}))
      for (const e of sc.model.entities)
        out.add(pattern.replace(/\{(\w+)\}/g, (_, k: string) => (k === 'stage' ? st.id : k === 'origin' ? e.origin : k === 'id' ? e.id : f[k] ?? `{${k}}`)))
  return [...out]
}

export const allTopics = (sc: Scenario) => [...streamTopics(sc), ...lifecycleTopics(sc)]
