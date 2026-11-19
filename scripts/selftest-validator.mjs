#!/usr/bin/env node
// Self-test for the scenario validator: break a valid scenario in specific ways and make sure
// each breakage is reported (and that the untouched scenario stays clean).
import { bridgeExpression, bridgeTopic } from '../src/scenarios/bridge.ts'
import { capitalMarkets } from '../src/scenarios/capital-markets/index.ts'
import { SCENARIOS } from '../src/scenarios/index.ts'
import { retailSupplyChain } from '../src/scenarios/retail-supply-chain/index.ts'
import { validateScenario } from '../src/scenarios/validate.ts'

const clone = () => structuredClone(capitalMarkets)
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}

// 1. every shipped scenario is clean
for (const sc of SCENARIOS) {
  const r = validateScenario(sc)
  check(`${sc.id} has no errors`, r.errors.length === 0, r.errors.join(' | '))
}

// 2. each mutation must produce an error containing `expect`
const mutations = [
  ['unknown hub in a link', (s) => s.sites.links.push(['CHI', 'NOPE']), 'unknown hub "NOPE"'],
  ['persona at unknown site', (s) => { s.personas[0].site = 'NOPE' }, 'unknown site "NOPE"'],
  ['disconnected site graph', (s) => { s.sites.hubs.push({ id: 'ISL', name: 'Island', dc: 'x', lon: 0, lat: 0, kind: 'dc' }) }, 'not connected'],
  ['origin with no ingest hub', (s) => { delete s.sites.ingest.CME }, 'no entry in sites.ingest'],
  ['architecture route to unknown node', (s) => { s.architecture.routes[1].hops[0][1] = 'ghost' }, 'unknown node "ghost"'],
  ['dead architecture subscription', (s) => { s.architecture.routes[1].sub = 'trade/nope/>' }, 'matches no topic'],
  ['dead persona subscription', (s) => { s.personas[2].subs[0] = 'md/bonds/>' }, 'matches no topic'],
  ['dead preset', (s) => { s.presets[0].sub = 'md/futures/LSE/>' }, 'matches no topic'],
  ['invalid subscription syntax', (s) => { s.presets[1].sub = 'md//quote' }, 'not a valid subscription'],
  ['bridge uses header the topic lacks', (s) => { s.kafka.topics[1].headers = { asset: 'group', sym: 'id' } }, 'does not carry'],
  ['bridge strips wrong prefix', (s) => { s.kafka.bridge.segments[4] = { topicSuffix: 'prices.' } }, 'does not start with'],
  ['bridge with fewer than 2 header levels', (s) => { s.kafka.bridge.segments = [{ literal: 'md' }, { header: 'asset' }, { topicSuffix: 'mktdata.' }] }, 'at least 2 header segments'],
  ['kafka weights do not sum to 1', (s) => { s.kafka.topics[0].weight = 0.9 }, 'weights sum'],
  ['lifecycle branch to missing stage', (s) => { s.lifecycle.stages[1].branches[0].to = 'nowhere' }, 'does not exist'],
  ['lifecycle status not declared', (s) => { s.lifecycle.stages[3].status = 'SHIPPED' }, 'not in lifecycle.statuses'],
  ['lifecycle with no terminal stage', (s) => { s.lifecycle.stages[5].next = 'oms/new'; s.lifecycle.stages[2].next = 'oms/new' }, 'no terminal stage'],
  ['branch probabilities over 1', (s) => { s.lifecycle.stages[1].branches.push({ to: 'ems/route', p: 0.99 }) }, 'sum to'],
  ['unknown pattern placeholder', (s) => { s.lifecycle.pattern += '/{colour}' }, '{colour}'],
  ['blotter facet not a lifecycle facet', (s) => { s.blotter.facet = 'team' }, 'not a lifecycle facet'],
  ['topic outside topicRoots', (s) => { s.topicRoots = ['md'] }, 'does not start with one of topicRoots'],
  ['duplicate entity id', (s) => { s.model.entities.push(structuredClone(s.model.entities[0])) }, 'duplicate entity id'],
  ['section without copy', (s) => { delete s.copy.kafka }, 'missing a title'],
]
for (const [name, mutate, expect] of mutations) {
  const s = clone()
  try {
    mutate(s)
    const { errors } = validateScenario(s)
    check(`catches: ${name}`, errors.some((e) => e.includes(expect)), errors.length ? `got: ${errors.slice(0, 2).join(' | ')}` : 'no errors reported')
  } catch (e) {
    check(`catches: ${name}`, false, `validator threw: ${e.message}`)
  }
}

// 2b. rules added with the retail scenario (entity attrs, column keys, lifecycle attributes)
const retailMutations = [
  ['entity missing an attr a header needs', (s) => { delete s.model.entities[3].attrs.region }, 'lack it'],
  ['header with an invalid field reference', (s) => { s.kafka.topics[0].headers.region = 'attrs.' }, 'not id/group/origin'],
  ['blotter column with an unknown key', (s) => { s.blotter.columns[2].key = 'warehouse' }, 'not a built-in column'],
  ['lifecycle attribute with no values', (s) => { s.lifecycle.attributes.service = [] }, 'has no values'],
  ['lifecycle attribute clashing with a facet', (s) => { s.lifecycle.attributes.channel = ['x'] }, 'clashes'],
  ['store with no ingest hub', (s) => { delete s.sites.ingest['SIN-09'] }, 'no entry in sites.ingest'],
  ['persona subscription matching nothing', (s) => { s.personas[3].subs[0] = 'retail/stock/MARS/>' }, 'matches no topic'],
  ['stock-out stage left unreachable', (s) => { s.lifecycle.stages[1].branches = [] }, 'unreachable'],
  ['category with no chip', (s) => { s.kafka.ui.chips.pop() }, 'has no chip for it'],
  ['more chips than colours', (s) => { s.kafka.ui.chips.push({ id: 'a', label: 'A' }, { id: 'b', label: 'B' }) }, '1-5 entries'],
  ['ui header the bridge does not use', (s) => { s.kafka.ui.idHeader = 'barcode' }, 'not a header used by the bridge'],
  ['ui extra column from a missing header', (s) => { s.kafka.ui.extra.header = 'zone' }, 'not carried by every kafka topic'],
  ['stage ids of different depth', (s) => { s.lifecycle.stages[0].id = 'placed'; s.lifecycle.stages[0].id = 'placed'; s.lifecycle.stages[8].next = undefined }, 'same number of "/" levels'],
  ['stage progress out of range', (s) => { s.lifecycle.stages[3].progress = 1.5 }, 'progress must be between'],
  ['diagram lead hop to unknown node', (s) => { s.architecture.routes[0].lead = { from: 'ghost', to: 'inv', color: 'var(--amber)' } }, 'lead hop uses unknown node'],
  ['hybrid with wrong number of boxes', (s) => { s.hybrid.onPrem.pop() }, 'exactly 3 entries'],
  ['watch level thresholds out of order', (s) => { s.watch.level.critical = 0.7 }, 'watch.level needs'],
  ['sawtooth that never reorders', (s) => { s.model.entities[0].value.sawtooth.reorder = 1.5 }, 'sawtooth needs'],
  ['blotter column with a zero weight', (s) => { s.blotter.columns[1].weight = 0 }, 'weight must be greater than 0'],
  ['watch with three value columns', (s) => { s.watch.columns = ['A', 'B', 'C'] }, '1 or 2 entries'],
]
for (const [name, mutate, expect] of retailMutations) {
  const s = structuredClone(retailSupplyChain)
  try {
    mutate(s)
    const r = validateScenario(s)
    check(`retail catches: ${name}`, [...r.errors, ...r.warnings].some((e) => e.includes(expect)), `got: ${[...r.errors, ...r.warnings].slice(0, 2).join(' | ') || 'nothing'}`)
  } catch (e) {
    check(`retail catches: ${name}`, false, `validator threw: ${e.message}`)
  }
}

// 3. the bridge: emulation and Solace expression come from the same segments
const seg = capitalMarkets.kafka.bridge.segments
check('bridge emulation', bridgeTopic(seg, 'mktdata.trade', { asset: 'fx', venue: 'EBS', sym: 'EURUSD' }) === 'md/fx/EBS/EURUSD/trade')
check(
  'bridge expression',
  bridgeExpression(seg) === 'md/${kafkaHeaderAsString("asset")}/${kafkaHeaderAsString("venue")}/${kafkaHeaderAsString("sym")}/${replace(kafkaTopic(),"mktdata.","")}',
  bridgeExpression(seg),
)
let threw = false
try { bridgeTopic(seg, 'mktdata.quote', { asset: 'fx' }) } catch { threw = true }
check('bridge refuses a record missing a header', threw)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
