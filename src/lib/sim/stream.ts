import { bridgeTopic, headersFor } from '../../scenarios/bridge.ts'
import type { Scenario } from '../../scenarios/types.ts'
import { broker } from '../broker'
import { isPaused, scaled } from '../pause'
import { currentValue, pick, setValue } from './records'

// Entity feed: every entity's headline value does a random walk (optionally pulled back toward its
// start, e.g. restocking) and is published on the Solace topic the Kafka bridge would produce
// for the scenario's first Kafka topic (md/.../quote, retail/stock/.../level).

export type Tick = { id: string; bid: number; ask: number; last: number; size: number; chg: number }

let started = false

export function startStream(sc: Scenario) {
  if (started) return
  started = true
  const { entities } = sc.model
  const first = sc.kafka.topics[0]
  const topicOf = new Map(entities.map((e) => [e.id, bridgeTopic(sc.kafka.bridge.segments, first.name, headersFor(first, e))]))
  for (const e of entities) setValue(e, e.value.sawtooth ? e.value.start * (0.5 + Math.random() * 0.5) : e.value.start)

  const loop = () => {
    if (isPaused()) { setTimeout(loop, 150); return }
    const burst = 2 + Math.floor(Math.random() * 4)
    for (let k = 0; k < burst; k++) {
      const e = pick(entities)
      const { start, decimals, volatility, meanReversion = 0, sawtooth } = e.value
      const px = currentValue(e)
      let v: number
      if (sawtooth) {
        // sales drain the shelf; below the reorder point a delivery refills it
        v = px - start * sawtooth.drain * (0.3 + Math.random() * 1.4) + (Math.random() - 0.5) * volatility * px * 0.3
        if (v < start * sawtooth.reorder) v = start * sawtooth.refill * (0.92 + Math.random() * 0.08)
      } else {
        const drift = (Math.random() - 0.5) * 2 * volatility * px + meanReversion * (start - px)
        v = Math.max(0.0001, px + drift)
      }
      setValue(e, v)
      const spread = v * 0.00005 + Math.pow(10, -decimals)
      const tick: Tick = {
        id: e.id,
        bid: v - spread / 2,
        ask: v + spread / 2,
        last: v,
        size: Math.ceil(Math.random() * 50) * Number(e.params?.quoteLot ?? 1),
        chg: ((v - start) / start) * 100,
      }
      broker.publish(topicOf.get(e.id)!, tick)
    }
    setTimeout(loop, scaled(60 + Math.random() * 120))
  }
  loop()
}

/** Subscription for one entity's feed topic (for the watch list), e.g. md/futures/CME/ES/quote. */
export const feedTopic = (sc: Scenario, entityId: string) => {
  const e = sc.model.entities.find((x) => x.id === entityId)!
  const first = sc.kafka.topics[0]
  return bridgeTopic(sc.kafka.bridge.segments, first.name, headersFor(first, e))
}

/** Subscription that matches every entity feed tick: the bridge's leading literals plus '>' (md/>, retail/stock/>). */
export const feedSubscription = (sc: Scenario) => {
  const lead: string[] = []
  for (const seg of sc.kafka.bridge.segments) { if (!('literal' in seg)) break; lead.push(seg.literal.replace(/\/$/, '')) }
  return `${lead.join('/')}/>`
}
