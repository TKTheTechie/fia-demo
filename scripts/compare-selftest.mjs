#!/usr/bin/env node
// Unit checks for the Kafka-vs-Solace comparison models (pure logic, no browser).
import { KafkaGroup } from '../src/lib/sim/compare/kafkaGroup.ts'
import { SolaceQueue } from '../src/lib/sim/compare/solaceQueue.ts'
import { TopicsSim } from '../src/lib/sim/compare/topics.ts'
import { stickyAssign, remapShare } from '../src/lib/sim/compare/assign.ts'

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail++ }

// assignment
const a = stickyAssign([], 8, ['a', 'b'])
ok(a.map.filter((x) => x === 'a').length === 4, 'sticky: 8 partitions / 2 consumers = 4 each')
const b = stickyAssign(a.map, 8, ['a', 'b', 'c'])
ok(b.moved.length === 2 && b.map.filter((x) => x === 'c').length === 2, `sticky: adding a 3rd consumer moves only the surplus (${b.moved.length} of 8)`)
ok(stickyAssign(b.map, 8, ['a', 'b']).moved.length <= 3, 'sticky: removing a consumer moves only its partitions')

// Kafka classic = stop the world; KIP-848 = only moved partitions
const kc = new KafkaGroup(6, 2)
const r1 = kc.addConsumer(0).rebalance
ok(r1 && r1.stopTheWorld && r1.stalled.length === 6, 'kafka classic: join stalls ALL partitions')
const k8 = new KafkaGroup(6, 2); k8.setMode('kip848', 0)
const r2 = k8.addConsumer(0).rebalance
ok(r2 && !r2.stopTheWorld && r2.stalled.length === 2, 'kafka KIP-848: join stalls only the 2 moved partitions')
const kk = new KafkaGroup(4, 6)
ok(kk.idleConsumers().length === 2, 'kafka: consumers beyond partition count sit idle')
const ks = new KafkaGroup(4, 6); ks.setMode('share', 0)
ok(ks.idleConsumers().length === 0 && ks.canProcess(0, 0), 'kafka share group: no idle consumers, parallelism not capped by partitions')
ok(kc.addPartition(0, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => 'sku' + x))?.remapped >= 0, 'kafka: adding a partition reports key remap share')
const kp = new KafkaGroup(12, 1); ok(kp.addPartition(0, []) === undefined, 'kafka: partition count capped at 12')

// Solace
const sq = new SolaceQueue('orders', 'partitioned', 8, 2)
const h = sq.addConsumer(0).handoff
ok(h && h.moved.length === 2 && sq.stalledUntil.filter((x) => x > 0).length === 2, 'solace partitioned: join pauses ONLY the 2 moved partitions')
ok(sq.route('k1', 10_000).consumer !== null, 'solace: stalled partitions resume')
const nx = new SolaceQueue('fraud', 'non-exclusive', 4, 3)
ok(new Set([1, 2, 3, 4, 5, 6].map((i) => nx.route('k', 0).consumer)).size === 3, 'solace non-exclusive: round-robin over all consumers')
ok(!nx.ordered, 'solace non-exclusive: no ordering with >1 consumer')
const ex = new SolaceQueue('audit', 'exclusive', 4, 3)
ok(ex.route('k', 0).consumer === 'audit-1' && ex.idleConsumers().length === 2, 'solace exclusive: one active, rest standby')
ok(sq.setPartitions(4, 0)?.serviceAffecting === true, 'solace: partition-count change flagged service affecting')

// topics
const t = new TopicsSim([{ name: 'stock.level', partitions: 4 }, { name: 'stock.movement', partitions: 2 }])
t.add({ id: 'east', name: 'East', subs: ['retail/stock/east/>'] })
const ev = { seq: 1, key: 's1', kafkaTopic: 'stock.level', solaceTopic: 'retail/stock/west/st1/g/s1/level' }
const d = t.publish(ev)
ok(d.length === 1 && d[0].side === 'kafka' && !d[0].useful, 'topics: non-matching event is fetched-and-discarded in Kafka, never delivered by Solace')
t.arrive('kafka', 'east', ev, false); ok(t.kafka.get('east').discarded === 1, 'topics: discard counted')
t.arrive('solace', 'east', { ...ev, seq: 5 }, true); t.arrive('solace', 'east', { ...ev, seq: 3 }, true)
ok(t.solace.get('east').outOfOrder === 1, 'topics: out-of-order arrival detected')

t.traceKey = 's1'
t.arrive('kafka', 'east', { ...ev, seq: 9, solaceTopic: 'retail/stock/east/st1/g/s1/level' }, true); t.arrive('kafka', 'east', { ...ev, seq: 7 }, true)
const tr = t.trace.get('kafka|east')
ok(tr?.length === 2 && !tr[0].late && tr[1].late, 'topics: trace records arrival order and flags the late event')
console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
