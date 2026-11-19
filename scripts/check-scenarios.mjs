#!/usr/bin/env node
// Validates every registered scenario (src/scenarios/index.ts): broken references, dead
// subscriptions, bridge/header mismatches, disconnected site graphs...
// Runs the TypeScript directly with Node's built-in type stripping (Node 22.18+ / 24).
//
//   npm run check:scenarios            all scenarios
//   npm run check:scenarios -- retail  one scenario
//   npm run check:scenarios -- --topics   also print every topic each scenario can emit
import { allTopics, bridgeExpression } from '../src/scenarios/bridge.ts'
import { SCENARIOS } from '../src/scenarios/index.ts'
import { validateScenario } from '../src/scenarios/validate.ts'

const args = process.argv.slice(2)
const showTopics = args.includes('--topics')
const only = args.filter((a) => !a.startsWith('--'))
const list = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS

if (!list.length) {
  console.error(`No scenario matched ${JSON.stringify(only)}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`)
  process.exit(2)
}

let failed = 0
for (const sc of list) {
  const { errors, warnings } = validateScenario(sc)
  const mark = errors.length ? 'FAIL' : 'ok  '
  const topics = errors.length ? [] : allTopics(sc)
  console.log(`${mark} ${sc.id}  (${sc.model.entities.length} entities, ${sc.kafka.topics.length} kafka topics, ${topics.length} solace topics)`)
  if (!errors.length) console.log(`     bridge: ${bridgeExpression(sc.kafka.bridge.segments)}`)
  for (const e of errors) console.log(`  ERROR   ${e}`)
  for (const w of warnings) console.log(`  warning ${w}`)
  if (showTopics) for (const t of topics) console.log(`     ${t}`)
  if (errors.length) failed++
}
process.exit(failed ? 1 : 0)
