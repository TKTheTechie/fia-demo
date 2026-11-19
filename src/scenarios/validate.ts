import { topicMatches } from '../lib/broker.ts'
import { allTopics, bridgeTopic, headersFor } from './bridge.ts'
import { BUILTIN_COLUMN_KEYS } from './types.ts'
import type { FieldRef, Scenario } from './types.ts'

export type Report = { errors: string[]; warnings: string[] }

const BUILTIN_FIELDS = ['id', 'group', 'origin']
const FORMATS = ['id', 'side', 'text', 'int', 'progress', 'price', 'status']
const TONES = ['new', 'ack', 'partial', 'done', 'bad']
const SECTIONS = ['flow', 'topics', 'latency', 'wan', 'throughput', 'hybrid', 'kafka', 'global', 'blotter']

/** Same rule the topic-routing box uses: levels are non-empty, no spaces, '>' only as the last level. */
export function isValidSubscription(sub: string): boolean {
  if (!/^[^/\s]+(\/[^/\s]+)*$/.test(sub)) return false
  const levels = sub.split('/')
  return levels.every((l, i) => l !== '>' || i === levels.length - 1) && !levels.some((l) => l.includes('>') && l !== '>')
}

const isFieldRef = (r: string): r is FieldRef => BUILTIN_FIELDS.includes(r) || /^attrs\.[A-Za-z][\w-]*$/.test(r)

const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i)

export function validateScenario(sc: Scenario): Report {
  const errors: string[] = []
  const warnings: string[] = []
  const err = (m: string) => errors.push(`${sc.id}: ${m}`)
  const warn = (m: string) => warnings.push(`${sc.id}: ${m}`)

  // --- identity & sections
  if (!/^[a-z][a-z0-9-]*$/.test(sc.id)) err(`id "${sc.id}" must be kebab-case`)
  if (!sc.title.trim()) err('title is empty')
  if (!sc.topicRoots.length) err('topicRoots is empty')
  if (!sc.hero.title[0] || !sc.hero.title[1]) err('hero.title needs two lines')
  dupes(sc.sections).forEach((s) => err(`section "${s}" listed twice`))
  for (const s of sc.sections) {
    if (!SECTIONS.includes(s)) err(`unknown section "${s}"`)
    if (!sc.copy[s]?.title) err(`copy for section "${s}" is missing a title`)
  }

  // --- entity model
  const { entities } = sc.model
  if (!entities.length) err('model.entities is empty')
  dupes(entities.map((e) => e.id)).forEach((id) => err(`duplicate entity id "${id}"`))
  for (const e of entities) {
    if (!e.group || !e.origin) err(`entity "${e.id}" needs group and origin`)
    if (!(e.value.start > 0)) err(`entity "${e.id}": value.start must be > 0`)
    if (!Number.isInteger(e.value.decimals) || e.value.decimals < 0) err(`entity "${e.id}": value.decimals must be an integer >= 0`)
    if (e.value.volatility < 0) err(`entity "${e.id}": value.volatility must be >= 0`)
  }
  const origins = [...new Set(entities.map((e) => e.origin))]

  // --- kafka + bridge
  const { topics, bridge } = sc.kafka
  if (!topics.length) err('kafka.topics is empty')
  dupes(topics.map((t) => t.name)).forEach((n) => err(`duplicate kafka topic "${n}"`))
  const weight = topics.reduce((a, t) => a + t.weight, 0)
  if (Math.abs(weight - 1) > 0.01) err(`kafka topic weights sum to ${weight.toFixed(2)}, expected 1`)
  let bridgeOk = true
  for (const t of topics) {
    if (t.partitions < 1) err(`kafka topic "${t.name}": partitions must be >= 1`)
    const refs: [string, string][] = [['keyBy', t.keyBy], ...Object.entries(t.headers).map(([h, f]) => [`header "${h}"`, f] as [string, string])]
    for (const [what, ref] of refs) {
      if (!isFieldRef(ref)) { err(`kafka topic "${t.name}": ${what} maps to "${ref}", which is not id/group/origin or attrs.<name>`); continue }
      if (ref.startsWith('attrs.')) {
        const missing = entities.filter((e) => e.attrs?.[ref.slice(6)] === undefined).map((e) => e.id)
        if (missing.length) err(`kafka topic "${t.name}": ${what} uses ${ref} but ${missing.length} entit${missing.length > 1 ? 'ies' : 'y'} lack it (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''})`)
      }
    }
    for (const s of bridge.segments) {
      if ('header' in s && !(s.header in t.headers)) { err(`bridge uses header "${s.header}" which kafka topic "${t.name}" does not carry`); bridgeOk = false }
      if ('topicSuffix' in s && !t.name.startsWith(s.topicSuffix)) { err(`bridge strips "${s.topicSuffix}" which kafka topic "${t.name}" does not start with`); bridgeOk = false }
    }
  }
  if (!bridge.segments.length) err('kafka.bridge.segments is empty')
  // The Kafka section's comparison tabs build consumer needs, partition keys and views from header levels.
  if (bridge.segments.filter((x) => 'header' in x).length < 2) err('kafka.bridge needs at least 2 header segments (the comparison tabs pin and key on them)')
  if (topics[0] && Object.keys(topics[0].headers).length < 2) err(`kafka topic "${topics[0].name}" needs at least 2 headers (they are the partition-key choices in the comparison tabs)`)
  for (const t of topics) if (t.render && !['bidask', 'value', 'delta'].includes(t.render)) err(`kafka topic "${t.name}": unknown render "${t.render}"`)

  // --- kafka UI (chips, filters, columns)
  const ui = sc.kafka.ui
  const bridgeHeaders = bridge.segments.flatMap((s) => ('header' in s ? [s.header] : []))
  for (const [what, h] of [['chipHeader', ui.chipHeader], ['idHeader', ui.idHeader]] as const)
    if (!bridgeHeaders.includes(h)) err(`kafka.ui.${what} "${h}" is not a header used by the bridge segments`)
  if (ui.extra.header && !topics.every((t) => ui.extra.header! in t.headers)) err(`kafka.ui.extra.header "${ui.extra.header}" is not carried by every kafka topic`)
  if (ui.chips.length < 1 || ui.chips.length > 5) err(`kafka.ui.chips must have 1-5 entries (there are 5 colours), found ${ui.chips.length}`)
  dupes(ui.chips.map((c) => c.id)).forEach((id) => err(`duplicate kafka.ui chip "${id}"`))
  // chips filter on the chipHeader; for this to be meaningful its values must be the entities' values
  for (const t of topics) {
    const ref = t.headers[ui.chipHeader]
    if (!ref || !isFieldRef(ref)) continue
    const values = new Set(entities.map((e) => (ref.startsWith('attrs.') ? e.attrs?.[ref.slice(6)] : e[ref as 'id' | 'group' | 'origin'])))
    for (const v of values) if (v && !ui.chips.some((c) => c.id === v)) err(`entities have ${ui.chipHeader}="${v}" but kafka.ui.chips has no chip for it`)
    for (const c of ui.chips) if (!values.has(c.id)) warn(`kafka.ui chip "${c.id}" matches no entity`)
    break
  }
  const lv = sc.watch.level
  if (lv && !(lv.critical > 0 && lv.critical < lv.low && lv.low < 1 && lv.capacity > 1)) err('watch.level needs 0 < critical < low < 1 < capacity')
  for (const e of sc.model.entities) {
    const sw = e.value.sawtooth
    if (sw && !(sw.drain > 0 && sw.reorder > 0 && sw.reorder < sw.refill)) err(`entity "${e.id}": sawtooth needs drain > 0 and 0 < reorder < refill`)
  }
  if (sc.watch.columns.length < 1 || sc.watch.columns.length > 2) err('watch.columns must have 1 or 2 entries')
  if (sc.hybrid.onPrem.length !== 3 || sc.hybrid.cloud.length !== 3) err('hybrid.onPrem and hybrid.cloud must each have exactly 3 entries')
  if (!sc.blotter.kpis.total || !sc.blotter.kpis.done || !sc.blotter.kpis.bad) err('blotter.kpis needs total, done and bad labels')

  // --- lifecycle
  const lc = sc.lifecycle
  const stageIds = lc.stages.map((s) => s.id)
  dupes(stageIds).forEach((id) => err(`duplicate lifecycle stage "${id}"`))
  const statusIds = lc.statuses.map((s) => s.id)
  for (const s of lc.statuses) if (!TONES.includes(s.tone)) err(`status "${s.id}": unknown tone "${s.tone}"`)
  for (const st of lc.stages) {
    if (!statusIds.includes(st.status)) err(`stage "${st.id}": status "${st.status}" is not in lifecycle.statuses`)
    if (st.statusWhileRepeating && !statusIds.includes(st.statusWhileRepeating)) err(`stage "${st.id}": statusWhileRepeating "${st.statusWhileRepeating}" is not in lifecycle.statuses`)
    if (st.delayMs[0] < 0 || st.delayMs[0] > st.delayMs[1]) err(`stage "${st.id}": delayMs must be [min, max] with 0 <= min <= max`)
    if (st.next && !stageIds.includes(st.next)) err(`stage "${st.id}": next "${st.next}" does not exist`)
    if (st.progress !== undefined && (st.progress < 0 || st.progress > 1)) err(`stage "${st.id}": progress must be between 0 and 1`)
    if (st.repeat && (st.repeat[0] < 1 || st.repeat[0] > st.repeat[1])) err(`stage "${st.id}": repeat must be [min, max] with 1 <= min <= max`)
    let p = 0
    for (const b of st.branches ?? []) {
      if (!stageIds.includes(b.to)) err(`stage "${st.id}": branch target "${b.to}" does not exist`)
      if (b.p < 0 || b.p > 1) err(`stage "${st.id}": branch probability ${b.p} out of range`)
      p += b.p
    }
    if (p > 1) err(`stage "${st.id}": branch probabilities sum to ${p.toFixed(2)} (> 1)`)
  }
  if (new Set(lc.stages.map((s) => s.id.split('/').length)).size > 1)
    err('lifecycle stage ids must all have the same number of "/" levels (the blotter filter relies on it)')
  if (lc.qty && (lc.qty[0] < 1 || lc.qty[0] > lc.qty[1])) err('lifecycle.qty must be [min, max] with 1 <= min <= max')
  if (lc.stages.length) {
    // every stage reachable from the first
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const st = lc.stages.find((s) => s.id === id)
      if (!st) return
      if (st.next) walk(st.next)
      st.branches?.forEach((b) => walk(b.to))
    }
    walk(lc.stages[0].id)
    for (const id of stageIds) if (!seen.has(id)) warn(`lifecycle stage "${id}" is unreachable from "${lc.stages[0].id}"`)
    if (!lc.stages.some((s) => !s.next && !s.branches?.length)) err('lifecycle has no terminal stage (every stage has a next)')
  } else err('lifecycle.stages is empty')
  for (const [k, vals] of Object.entries(lc.facets)) if (!vals.length) err(`lifecycle facet "${k}" has no values`)
  for (const [, key] of lc.pattern.matchAll(/\{(\w+)\}/g))
    if (!['stage', 'origin', 'id'].includes(key) && !(key in lc.facets)) err(`lifecycle.pattern uses {${key}} which is not stage/origin/id or a facet`)
  if (!(sc.blotter.facet in lc.facets)) err(`blotter.facet "${sc.blotter.facet}" is not a lifecycle facet`)
  dupes(sc.blotter.columns.map((c) => c.key)).forEach((k) => err(`duplicate blotter column "${k}"`))
  const columnKeys = [...BUILTIN_COLUMN_KEYS, ...Object.keys(lc.facets), ...Object.keys(lc.attributes ?? {})]
  for (const [k, vals] of Object.entries(lc.attributes ?? {})) {
    if (!vals.length) err(`lifecycle attribute "${k}" has no values`)
    if (k in lc.facets || BUILTIN_COLUMN_KEYS.includes(k)) err(`lifecycle attribute "${k}" clashes with a facet or built-in column`)
  }
  for (const c of sc.blotter.columns) {
    if (!FORMATS.includes(c.format)) err(`blotter column "${c.key}": unknown format "${c.format}"`)
    if (!columnKeys.includes(c.key)) err(`blotter column "${c.key}" is not a built-in column, lifecycle facet or lifecycle attribute`)
    if (c.weight !== undefined && !(c.weight > 0)) err(`blotter column "${c.key}": weight must be greater than 0`)
  }

  // --- topics actually emitted (only if the pieces above are sound enough to compute them)
  let emitted: string[] = []
  if (bridgeOk && !errors.length) {
    try {
      emitted = allTopics(sc)
      for (const t of emitted) {
        if (!isValidSubscription(t) || /[*>]/.test(t)) err(`generates an invalid topic: "${t}"`)
        else if (!sc.topicRoots.includes(t.split('/')[0])) err(`topic "${t}" does not start with one of topicRoots [${sc.topicRoots.join(', ')}]`)
      }
      // spot-check that bridge output is deterministic and uses only headers + topic name
      const t0 = topics[0], e0 = entities[0]
      if (bridgeTopic(bridge.segments, t0.name, headersFor(t0, e0)) !== bridgeTopic(bridge.segments, t0.name, headersFor(t0, e0))) err('bridge is not deterministic')
    } catch (e) {
      err(`could not enumerate topics: ${(e as Error).message}`)
    }
  }
  const matchesSomething = (sub: string) => emitted.some((t) => topicMatches(sub, t))

  // --- architecture
  const nodeIds = sc.architecture.nodes.map((n) => n.id)
  dupes(nodeIds).forEach((id) => err(`duplicate architecture node "${id}"`))
  for (const r of sc.architecture.routes) {
    if (!isValidSubscription(r.sub)) err(`architecture route "${r.sub}" is not a valid subscription`)
    else if (emitted.length && !matchesSomething(r.sub)) err(`architecture route "${r.sub}" matches no topic this scenario publishes`)
    if (r.sample < 0 || r.sample > 1) err(`architecture route "${r.sub}": sample out of range`)
    for (const [a, b] of r.hops) for (const n of [a, b]) if (!nodeIds.includes(n)) err(`architecture route "${r.sub}": unknown node "${n}"`)
    if (r.lead) for (const n of [r.lead.from, r.lead.to]) if (!nodeIds.includes(n)) err(`architecture route "${r.sub}": lead hop uses unknown node "${n}"`)
  }

  // --- sites & consumers
  const hubIds = sc.sites.hubs.map((h) => h.id)
  dupes(hubIds).forEach((id) => err(`duplicate hub "${id}"`))
  const linkKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  dupes(sc.sites.links.map(([a, b]) => linkKey(a, b))).forEach((l) => err(`duplicate link ${l}`))
  for (const [a, b] of sc.sites.links) for (const h of [a, b]) if (!hubIds.includes(h)) err(`link ${a}-${b}: unknown hub "${h}"`)
  if (hubIds.length) {
    const adj = new Map<string, string[]>(hubIds.map((h) => [h, []]))
    for (const [a, b] of sc.sites.links) { adj.get(a)?.push(b); adj.get(b)?.push(a) }
    const seen = new Set([hubIds[0]])
    const q = [hubIds[0]]
    while (q.length) for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
    const lost = hubIds.filter((h) => !seen.has(h))
    if (lost.length) err(`site graph is not connected; unreachable from ${hubIds[0]}: ${lost.join(', ')}`)
  }
  for (const h of Object.keys(sc.sites.kafkaBadge ?? {})) if (!hubIds.includes(h)) err(`sites.kafkaBadge: unknown hub "${h}"`)
  for (const o of origins) if (!(o in sc.sites.ingest)) err(`entity origin "${o}" has no entry in sites.ingest`)
  for (const [o, h] of Object.entries(sc.sites.ingest)) {
    if (!hubIds.includes(h)) err(`sites.ingest["${o}"] -> unknown hub "${h}"`)
    if (!origins.includes(o)) warn(`sites.ingest has "${o}" but no entity has that origin`)
  }
  dupes(sc.personas.map((p) => p.id)).forEach((id) => err(`duplicate persona "${id}"`))
  const bySite = new Map<string, number>()
  for (const p of sc.personas) {
    bySite.set(p.site, (bySite.get(p.site) ?? 0) + 1)
    if (!hubIds.includes(p.site)) err(`persona "${p.id}": unknown site "${p.site}"`)
    if (!p.subs.length) err(`persona "${p.id}" has no subscriptions`)
    for (const s of p.subs) {
      if (!isValidSubscription(s)) err(`persona "${p.id}": "${s}" is not a valid subscription`)
      else if (emitted.length && !matchesSomething(s)) err(`persona "${p.id}": subscription "${s}" matches no topic this scenario publishes`)
    }
  }
  for (const [site, n] of bySite) if (n > 1) warn(`${n} personas share site "${site}"; the global map shows one per site`)

  // --- presets
  for (const p of sc.presets) {
    if (!isValidSubscription(p.sub)) err(`preset "${p.sub}" is not a valid subscription`)
    else if (emitted.length && !matchesSomething(p.sub)) err(`preset "${p.sub}" (${p.desc}) matches no topic this scenario publishes`)
  }
  if (!sc.presets.length) warn('no topic-routing presets')

  return { errors, warnings }
}
