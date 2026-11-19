import type { Scenario } from '../../scenarios/types.ts'
import { broker } from '../broker'
import { isPaused, scaled } from '../pause'
import { currentValue, pick } from './records'

// Process simulator: walks items (orders, shipments, flights...) through the scenario's lifecycle
// state machine. Every stage is a publish on the topic built from `lifecycle.pattern`, so any
// component can tap in with a wildcard subscription.

export type Item = {
  id: string
  entity: string
  origin: string
  group: string
  qty: number
  filled: number
  avgValue: number
  status: string
  t: number
  latencyUs: number
  /** Facet and attribute values, e.g. { desk, side, strategy } or { channel, service }. */
  fields: Record<string, string>
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)
let started = false

/** Topic for a stage of an item. */
export function stageTopic(sc: Scenario, stage: string, item: Pick<Item, 'origin' | 'entity' | 'fields'>) {
  return sc.lifecycle.pattern.replace(/\{(\w+)\}/g, (_, k: string) =>
    k === 'stage' ? stage : k === 'origin' ? item.origin : k === 'id' ? item.entity : (item.fields[k] ?? `{${k}}`),
  )
}

/** Subscription matching everything the lifecycle publishes: the pattern's leading literals plus '>' (trade/>, retail/order/>). */
export function lifecycleRoot(sc: Scenario) {
  const lead: string[] = []
  for (const lvl of sc.lifecycle.pattern.split('/')) { if (lvl.startsWith('{')) break; lead.push(lvl) }
  return `${lead.join('/')}/>`
}

/** Subscription matching every item at one stage, e.g. 'trade/oms/new/>'. */
export function stageSubscription(sc: Scenario, stage: string) {
  const [before] = sc.lifecycle.pattern.split('{stage}')
  return `${before}${stage}/>`
}

// Subscription that filters on one facet value, e.g. trade/*/*/ALGO/> (everything after the facet is '>').
export function facetSubscription(sc: Scenario, facet: string, value: string) {
  const depth = sc.lifecycle.stages[0].id.split('/').length
  const levels: string[] = []
  for (const lvl of sc.lifecycle.pattern.split('/')) {
    if (lvl === '{stage}') levels.push(...Array<string>(depth).fill('*'))
    else if (lvl === `{${facet}}`) { levels.push(value, '>'); break }
    else levels.push(/^\{\w+\}$/.test(lvl) ? '*' : lvl)
  }
  return levels.join('/')
}

export function startLifecycle(sc: Scenario) {
  if (started) return
  started = true
  const lc = sc.lifecycle
  const stages = new Map(lc.stages.map((s) => [s.id, s]))
  const [qMin, qMax] = lc.qty ?? [1, 40]
  let seq = 482_000

  const spawn = () => {
    if (isPaused()) { setTimeout(spawn, 250); return }
    const entity = pick(sc.model.entities)
    const lot = Number(entity.params?.orderLot ?? 1)
    const fields: Record<string, string> = {}
    for (const [k, vals] of Object.entries(lc.facets)) fields[k] = pick(vals)
    for (const [k, vals] of Object.entries(lc.attributes ?? {})) fields[k] = pick(vals)
    const item: Item = {
      id: `${lc.idPrefix ?? 'ORD'}-${(seq++).toString(36).toUpperCase()}`,
      entity: entity.id,
      origin: entity.origin,
      group: entity.group,
      qty: Math.round(rand(qMin, qMax + 1 - 1e-9)) * lot,
      filled: 0,
      avgValue: 0,
      status: lc.statuses[0].id,
      t: Date.now(),
      latencyUs: 0,
      fields,
    }
    const emit = (stage: string) => broker.publish(stageTopic(sc, stage, item), { ...item })

    const run = (stageId: string) => {
      const st = stages.get(stageId)!
      let reps = st.repeat ? Math.floor(rand(st.repeat[0], st.repeat[1] + 1)) : 1
      const fire = () => {
        if (isPaused()) { setTimeout(fire, 200); return } // in-flight items wait, then carry on
        const lastRep = reps === 1
        item.status = lastRep ? st.status : (st.statusWhileRepeating ?? st.status)
        if (st.progress !== undefined) item.filled = Math.round(item.qty * st.progress)
        else if (st.repeat) {
          // fill in chunks of the remaining quantity; the last repeat takes whatever is left
          const remaining = item.qty - item.filled
          const q = lastRep ? remaining : Math.min(remaining, Math.ceil((remaining * rand(0.3, 0.7)) / lot) * lot)
          const px = currentValue(entity) * (1 + (Math.random() - 0.5) * 0.0002)
          item.avgValue = (item.avgValue * item.filled + px * q) / (item.filled + q)
          item.filled += q
        }
        if (!item.latencyUs && lc.statuses.find((x) => x.id === st.status)?.tone === 'ack') item.latencyUs = +rand(2, 8).toFixed(1)
        emit(st.id)
        reps--
        if (reps > 0) { setTimeout(fire, scaled(rand(st.delayMs[0], st.delayMs[1]))); return }
        // done with this stage: branch or continue
        let next = st.next
        for (const b of st.branches ?? []) if (Math.random() < b.p) { next = b.to; break }
        if (next) run(next)
      }
      const wait = rand(st.delayMs[0], st.delayMs[1])
      if (wait <= 0) fire()
      else setTimeout(fire, scaled(wait))
    }
    run(lc.stages[0].id)
    setTimeout(spawn, scaled(350 + Math.random() * 700))
  }
  spawn()
}
