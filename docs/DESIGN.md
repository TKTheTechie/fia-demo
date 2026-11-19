# Event Mesh Demo — design & refactor plan

Status: DRAFT. Phases 0 to 3 and 5 (retail) are done, plus the Kafka vs Solace comparison section (3.5) and the authoring guide ([NEW-SCENARIO.md](NEW-SCENARIO.md)); see section 10. · Base: copy of `fia-demo` (FIA Expo booth demo) · Date: 2026-11-17 · Last updated: 2026-11-19
Scope agreed 2026-11-17: **simulation only for now**. Real broker / Nisshi / live mode is deferred (phase 6).

## 1. Goals

1. **Reskin per prospect.** An SE should be able to produce a prospect-specific demo by editing data files, not React.
2. **Ship sample scenarios** for: capital markets (existing), retail / supply chain, logistics, airlines, energy / IoT, healthcare, manufacturing.
3. **Real event streams, optional.** Sample generators → Nisshi (Kafka-protocol engine) → Solace Cloud (integrated Kafka bridge) → browser over WebSocket.
4. **Always works offline.** The static site with simulated data stays the default and the fallback.

Non-goals (for now): a general-purpose dashboard builder; production-grade security; real customer data.

## 2. What exists today (summary)

- Vite + React + TS static site, ~3.1k lines, no backend, no Solace dependency.
- `lib/broker.ts`: 46-line in-browser pub/sub with Solace topic semantics. Everything subscribes to it.
- `lib/market.ts` and `lib/orders.ts`: simulators (random-walk quotes, timer-driven order lifecycle).
- Domain knowledge is hardcoded in many places: instruments, desks, hubs/ingest map, architecture nodes and routes, topic strings (`md/...`, `trade/...`), blotter columns, section copy.
- Only Latency, Throughput, FormFactors and Hero read from `content.ts`.
- KafkaBridge and GlobalBlotters each run their own private generator and (for KafkaBridge) a private second `Broker`, so the "Kafka" content is not tied to the main bus.

## 3. Target architecture

Four layers. Dependencies point downward only.

```
 Brand overlay   (who the demo is for: name, logo, colours, client strip, claims overrides)
 Scenario pack   (what the demo is about: domain model, topics, generators, diagram, sites, personas, copy)
 Section library (generic, data-driven React sections)
 Runtime         (Bus interface: SimBus | SolaceBus; source runner; mode/status; kiosk, theme)
```

### 3.1 Brand vs scenario (two separate things)

- **Scenario** = domain. Reusable across prospects (e.g. `retail`).
- **Brand** = prospect skin. A small JSON loaded at runtime, so an SE can drop one in `public/brands/acme.json` and open `?scenario=retail&brand=acme` with no rebuild:

```jsonc
{ "name": "Acme Retail", "logo": "brands/acme.svg",
  "colors": { "brand": "#e4572e" },
  "hero": { "eyebrow": "Acme · Digital Summit", "title": ["Every store.", "One event mesh."] },
  "clients": [],                       // optional override
  "sites": [ { "id": "DC1", "name": "Dallas DC", "lon": -96.8, "lat": 32.8 } ]  // optional override
}
```

### 3.2 Scenario pack

One folder per scenario: `src/scenarios/<id>/`

```
index.ts           the Scenario (data only). Built today: src/scenarios/capital-markets/index.ts
generators.ts      (planned) pure functions: (state, rng) -> Kafka-style records, runs in browser AND Node
schemas/*.json     (planned) JSON Schema per Kafka topic, for Nisshi validation later
README.md          talk track, suggested subscriptions, what to point at
```

The type is implemented in `src/scenarios/types.ts` (it is the source of truth; this is the summary):

- `id`, `title`, `vertical`, `topicRoots` (first topic level(s); also the ACL prefix in live mode)
- `hero`, `sections` (which sections, in order), `copy` per section
- `model`: the entities tracked (`id`, `group`, `origin`, a headline `value` with start/decimals/volatility, free-form `params`)
- `kafka`: flat `topics` (partitions, key, header-to-entity-field map, traffic weight, optional schema) and the `bridge`
- `lifecycle`: the process state machine (order / shipment / flight...): topic pattern, facets, stages with delays, branches and repeats, status tones
- `architecture`: diagram nodes and routes; `sites`: hubs, links and venue-to-hub ingest; `personas` (the "desks"); `presets`; `blotter` columns

Two decisions made while writing it, differing from the first sketch:

1. **Everything is data, no JSX.** Copy is a string with tiny inline markup: `[[accent]]` (gradient), `**bold**`, `` `code` ``. That keeps scenarios JSON-able, validatable, and easy for an SE (or an LLM) to author.
2. **The bridge is data, not a function.** It is a list of segments (`literal`, `header`, `topicSuffix`). One definition drives both the in-browser emulation (`bridgeTopic()`) and the real Kafka Receiver expression (`bridgeExpression()`), so sim and live cannot drift apart. The expression syntax is still unverified against a real broker (see 4.1).

Three more changes came from writing the second scenario (retail), which is what phase 5 is for:

3. **Entities have extra dimensions.** Retail topics need region, store, category and SKU, but an entity only had id/group/origin. Entities now carry `attrs` (e.g. `region`), and Kafka headers can reference them as `attrs.region`. The validator checks that every entity defines every attr a header needs.
4. **Lifecycle `attributes`.** Properties shown as columns but not in the topic (finance: side, strategy; retail: service level). Blotter column keys are now generic (`entity`, `origin`, `avgValue`, ...) and validated against built-ins, facets and attributes, instead of finance names like `sym`.
5. **Section numbers are automatic.** Eyebrows are labels only; the UI numbers them by position in `sections`. Retail omits the latency section, and `copy` only has to cover the sections listed.

To add a scenario, follow the step-by-step guide in [NEW-SCENARIO.md](NEW-SCENARIO.md).

Still to add when sections are wired: `generators` (pure, seedable) and `overrides` (the per-section component escape hatch).

`npm run check:scenarios` validates every scenario (broken references, dead subscriptions, bridge/header mismatches, disconnected site graph, lifecycle dead ends). `npm run selftest:scenarios` proves the validator catches 21 kinds of mistake.

Design choice: **configurable core + escape hatch**, not "everything is config". Some verticals will want a visual no generic section gives (a floor plan, a flight map). `overrides` lets a scenario replace one section without forking the library.

### 3.3 Runtime: the `Bus` interface

```ts
interface Bus {
  subscribe<T>(sub: string, fn: (m: Message<T>) => void): () => void
  publish?<T>(topic: string, payload: T, props?: Record<string, string>): void   // sim only
  status: 'sim' | 'connecting' | 'live' | 'degraded'
  onStatus(fn): () => void
}
```

- `SimBus` = today's `Broker`, unchanged semantics. The default.
- `SolaceBus` = `solclientjs` over Solace Web Messaging (WSS), or MQTT-over-WebSocket. Maps `subscribe` onto real topic subscriptions, so "filtered at the broker" is real.
- Nav shows a **SIM / LIVE** badge. Fallback to SimBus on connect failure, or if a live session is silent for N seconds (booth Wi-Fi). Switching is explicit (`?live`) so nobody gets live mode by accident.
- Sections depend only on `Bus`, never on `Broker` directly. Fixing today's private-bus pattern in KafkaBridge is part of this.

### 3.4 One generator codebase, two runtimes

Generators are written once as pure TS (`(state, rng) => KafkaRecord[]`, with a seedable RNG):

- **Sim mode:** the browser runs them, passes each record through `bridge.emulate()`, publishes on SimBus. This is exactly what the real bridge will do, so topics are identical in both modes.
- **Live mode:** a small Node runner (`tools/stream/`) runs the *same* generators and produces to Nisshi with a Kafka client. The real Kafka Receiver bridge does the mapping.
- **Parity test:** for each scenario, assert `emulate(record)` equals the topic the real bridge expression yields (unit test on the expression via a tiny evaluator, plus a manual live check).

### 3.5 The Kafka section: three tabs

One section (`kafka`), three tabs, all simulated and all driven by the scenario. Customers' biggest confusions are topics and consumer scaling, so the first two tabs exist to show them side by side; the third is the original bridge view, unchanged.

| Tab | Shows | Code |
|---|---|---|
| **Topics & ordering** | The same stream delivered to consumers that each want a slice. Kafka: flat topics, so a consumer fetches whole topics and discards (or a router app re-publishes into a dedicated topic: an extra hop, copy and merge). Ordering only holds within one topic + partition, so a consumer reading several topics sees one item's events arrive out of order. Solace: the consumer's topic subscriptions select events in the broker, one in-order stream across every matching topic, nothing to provision. A per-item **arrival-order strip** on each side flags late events. | `src/components/Compare.tsx` (`TopicsAct`), `src/lib/sim/compare/topics.ts` |
| **Consumer scaling** | One workload, three apps (Fulfilment, Fraud screen, Audit), each with a Kafka consumer group and a Solace queue. Kafka: partitions are added (never removed), consumers beyond the partition count sit idle, and the group protocol is switchable between classic (eager, stop-the-world), KIP-848 (incremental) and share groups (KIP-932: no idle consumers, no per-key ordering). Solace: per-app queue type (exclusive, non-exclusive, partitioned), consumers added or removed per app, partitions resized with a "drain first" procedure, and handoffs that pause only the partitions that change owner. **Partition key** (from the topic's headers) and per-app **views** (all, one region, one store) are shared by both sides, showing the topic, key and subscription on each. | `Compare.tsx` (`ScalingAct`), `src/lib/sim/compare/kafkaGroup.ts`, `solaceQueue.ts`, `assign.ts` |
| **Kafka bridge** | The original view: flat Kafka topics, the in-broker bridge, a filterable blotter (3.2 and 4.1). | `src/components/KafkaBridge.tsx` |

`src/components/Kafka.tsx` owns the heading and the tab bar. All tabs stay mounted (hidden when inactive) so their state survives a tab switch; hidden panes are off-screen, so their simulations pause themselves.

Design points worth knowing:

- **Pure models, unit-checked.** The behaviour (assignment, rebalance cost, queue types, ordering, partition resize, trace) is plain TS in `src/lib/sim/compare/` with no React; `node scripts/compare-selftest.mjs` checks it. The UI only drives time and draws.
- **Generic by construction.** Consumer needs, the partition-key choices and the views are generated from the scenario's `kafka.bridge` segments and first topic's headers, so every scenario gets them without extra data. Requirement (validated): the bridge uses at least 2 header levels and the first topic carries at least 2 headers.
- **Honest about Solace.** Resizing a partitioned queue changes the key-to-partition mapping, so doing it live reorders events. The default is the documented procedure (pause publishers, drain, resize, release); a toggle shows what happens if you scale without draining. Resizing is flagged service-affecting; removed partitions lose their messages.
- **Honest about Kafka.** Kafka can only add partitions, so the "-" button is disabled with a tooltip. Adding one remaps keys (the UI says what share). Share groups are included because they are production-ready in Kafka 4.2 and a Kafka-savvy customer will raise them.
- **Illustrative numbers.** Stall durations (2.6 s classic stop-the-world, 0.7 s KIP-848, 0.5 s Solace handoff), the 10 msg/s per consumer and the per-partition lag spread are chosen to be visible on screen, not measured.
- Pause freezes everything, speed hotkeys apply (`src/lib/pause.ts`).

## 4. Live pipeline

```
 generators (Node)  --Kafka protocol-->  Nisshi engine  --Kafka Receiver bridge-->  Solace Cloud service  --WSS-->  browser
   same TS as sim       topics + JSON       (sqlite/postgres)     (in-broker; topic from                  (read-only client,
                        Schema validated                          kafkaTopic()/headers)                   topic-root ACL)
                                      \--> optional: Delta Lake table --> DuckDB / Databricks   ("analytics" bonus section)
```

### 4.1 Kafka → Solace topic mapping

Per Solace docs, a Kafka Receiver topic binding builds the SMF topic with a **substitution expression** (example: `${replace(kafkaTopic(),".","/")}`). The Kafka topic name, partition and offset are exposed as user properties `k_topic`, `k_partition`, `k_offset`. All Kafka headers become SMF user properties, and the payload goes untouched into the binary attachment. A community thread reports header access in the expression via `${kafkaHeaderAsString("name")}`.

So each scenario's bridge expression looks like:

```
${replace(kafkaTopic(),".","/")}/${kafkaHeaderAsString("region")}/${kafkaHeaderAsString("site")}/${kafkaHeaderAsString("entity")}
```

and a script (`tools/stream/apply-bridge.ts`) can create the receiver and bindings on the Solace service from the scenario file (SEMP or Broker Manager).

### 4.2 Nisshi facts that shape the design (from the SE hands-on guide, tested on 0.8.0)

| Fact | Consequence |
|---|---|
| Speaks the Kafka wire protocol; standard clients work unchanged | Generators can use any Kafka client (kafkajs, confluent-kafka-javascript, librdkafka). |
| Backends: memory, sqlite, postgres, s3, null | Use **sqlite or postgres** for the demo (6–12 ms acks). S3 is ~70–130+ ms and experimental. Don't use S3 for anything latency-flavoured. |
| Per-topic schema (JSON/Avro/Proto) validated at the engine | Scenario `schemas/*.json` double as a live demo moment: send a bad record, watch it rejected. |
| Lake sink to Delta; DuckDB / Databricks read it | Optional "analytics / replay" section. Gotchas: with a lake enabled, **every topic needs a schema**, lake topics need **all fields present** (0.8.0), and DuckDB needs `read_parquet`, not `delta_scan`. |
| No transactional producers; idempotent OK | Generators must not use transactions. |
| Guide does not document **record headers** or **TLS/auth** | Both are open items (below). Headers matter: the bridge expression above depends on them. |
| Marked **internal-only until the October open-source announcement** | Confirm that has happened before it appears in a public repo/booth. |

### 4.3 Where things run

- Nisshi must be **reachable from the Solace Cloud service**. `localhost` on a laptop will not work. Plan: Nisshi on a small EC2 instance (same region as the Solace service), sqlite or postgres backend, security group limited to the Solace service egress.
- Generators run on the same box (or on the laptop pointing at it).
- Browser connects directly to the Solace service with a **read-only** client username whose ACL allows subscribe only on `<topicRoot>/>`. Those credentials are visible to anyone with the page, so use a throwaway message VPN and rate limits; keep them out of git (`.env.local`, injected at deploy).
- "Filtered at broker %" today is computed client-side. Live: subscribe to a sampled firehose plus the filtered subscription, or read Solace stats (SEMP monitor). Start with the client-side two-subscription approach.

## 5. Section generalisation

| Today | Becomes | Scenario supplies |
|---|---|---|
| Hero, nav, client strip | same, brand-driven | brand + `copy.hero` |
| Tape (price ticker) | **Ticker**: entities with a headline metric | `metrics` |
| Architecture (12 nodes, 7 routes) | same component | `architecture.nodes/routes` — already data-shaped, mostly a move |
| Topic routing | same | `taxonomy`, `presets` |
| Latency / Throughput / Form factors | unchanged, Solace-generic | `content.ts` (shared) |
| WAN map | **Sites map** | `sites` |
| Kafka bridge | **Kafka bridge** | `kafka.topics`, `bridge`, generator |
| Global blotters ("desks") | **Global consumers** ("personas") | `sites`, `personas`, `ingest` map |
| Order blotter | **Process tracker** (order / shipment / flight / work order) | `lifecycle`, `blotter.columns` |
| Market watch | **Live watch** (value + sparkline per entity) | `metrics` |
| **New:** Live status, schema-rejection, analytics/replay | optional sections | live-mode only |

## 6. Sample scenarios

Taxonomies are proposals; names invented for the demo. Kafka topics are flat (type in the name) with the routing dimensions in headers, which is the story the Kafka bridge section tells.

| Scenario | Entities | Example Solace topic | Flat Kafka topics | Lifecycle |
|---|---|---|---|---|
| Capital markets (existing) | instruments, orders | `md/{asset}/{venue}/{sym}/quote` · `trade/{stage}/{desk}/{venue}/{sym}` | `mktdata.quote`, `mktdata.trade`, `orders.event` | NEW→ACK→PARTIAL→FILLED/REJECTED |
| Retail / supply chain (**built**, `retail-supply-chain`) | SKUs at stores, orders | `retail/stock/{region}/{store}/{category}/{sku}/{level\|movement}` · `retail/order/{system}/{action}/{channel}/{store}/{sku}` | `stock.level`, `stock.movement` | PLACED→PICKING→PACKED→SHIPPED→DELIVERED, or STOCKOUT / CANCELLED |
| Logistics | vehicles, shipments | `logi/fleet/{region}/{vehicle}/position` · `logi/shipment/{carrier}/{lane}/{id}/{status}` | `fleet.position`, `shipment.event` | BOOKED→IN_TRANSIT→CUSTOMS→DELIVERED |
| Airlines | flights, bags | `air/flight/{airline}/{hub}/{flight}/{status}` · `air/baggage/{hub}/{flight}/{event}` | `flight.status`, `baggage.event` | SCHEDULED→BOARDING→DEPARTED→ARRIVED/DELAYED |
| Energy / IoT | meters, substations | `energy/grid/{region}/{substation}/{asset}/telemetry` | `grid.telemetry`, `grid.alarm` | alarm RAISED→ACK→CLEARED |
| Healthcare (synthetic only) | devices, departments | `health/{facility}/{dept}/{device}/vitals` | `device.vitals`, `adt.event` | ADMIT→TRANSFER→DISCHARGE |
| Manufacturing | lines, machines | `mfg/{plant}/{line}/{machine}/{metric}` | `machine.metric`, `workorder.event` | RELEASED→RUNNING→QC→DONE/SCRAP |

Healthcare rule: topics and payloads use **device/department tokens only, never patient identifiers**; all data synthetic.

## 7. Phased plan

Each phase leaves the existing demo working and visually identical until phase 5.

| # | Phase | Output | Verify |
|---|---|---|---|
| 0 | Baseline | **DONE.** `npm run smoke`: build, serve, drive every section in headless Chromium, 51 checks + screenshots | Passes on the unmodified demo; fails on injected bugs |
| 1 | `Bus` interface | `SimBus` + React context; sections stop importing `broker`; KafkaBridge/Global use the shared bus | Screenshots unchanged |
| 2 | Scenario type; move capital markets into `scenarios/capital-markets` | **DONE.** Type, validator, capital-markets data, and the app reads it | `npm run smoke` stays green (51/51) |
| 3 | Parameterise sections one at a time (Architecture, Topic routing, Ticker/Live watch, Process tracker, Sites, Global, Kafka) | **DONE** (all nine sections and the hero read the scenario). Product claims shared by all scenarios stay in `content.ts` | Smoke on both scenarios |
| 4 | Brand overlay + scenario/brand URL params + runtime JSON | `?scenario=…&brand=…` | Manual |
| 5 | **Second + third scenarios (retail, logistics)** | Proves the abstraction; expect the config type to change here. **Retail written as data, changed the type (see 3.2), and now runs: `?scenario=retail-supply-chain`. Logistics next.** | Validator + fresh-eyes demo |
| 6 | Live mode | `SolaceBus`, Node stream runner, Nisshi setup (compose/EC2 script), bridge apply script, SIM/LIVE badge + fallback | End-to-end on real Solace Cloud service |
| 7 | Remaining scenarios (airlines, energy, healthcare, manufacturing) + authoring guide / scaffold script | **Authoring guide DONE** ([NEW-SCENARIO.md](NEW-SCENARIO.md)). Scenarios and a `npm run new-scenario` scaffold still to do | One non-author builds a scenario |
| 8 | Content review gate | Claims checked, logos cleared | Sign-off |

Recommendation: do **phases 0–5 before any live work**. Live mode against a scenario-shaped config is much easier than retrofitting it onto the finance-specific code.

## 8. Claims to review before external use (item 9)

From `content.ts` and inline copy:

- Latency profiles: appliance 18 µs median / 27 µs p99; software 45 / 90 µs; "typical cloud message bus" 1.8 ms / 9 ms. Marked illustrative; confirm figures and that the comparison category is acceptable.
- "FPGA-accelerated", "deterministic microsecond messaging" (appliance).
- "Millions of messages per second", and "from software on a laptop to purpose-built appliances".
- Protocol list: SMF, MQTT, AMQP, JMS, REST, WebSocket, Kafka bridge, OpenTelemetry.
- "Fully managed … deployed in minutes", and the "Edge & Branch" lightweight-broker claim.
- "Kafka bridge integrated inside the broker, no separate connector to run": per docs, **software brokers only**, so it should not be implied for appliances.
- Architecture text: "guaranteed & direct", "replay · ordering · ACLs".
- Global view: "mesh only sends an event across a WAN link when someone on the far side asked for it", and the "WAN traffic avoided %" metric (computed against naive replication; illustrative).
- Client logo strip (J.P. Morgan, Citi, Wells Fargo, TMX, KRX, NSE, BSE, RBC, CIBC): confirm public-use permission. Probably drop from non-finance scenarios.
- Data-centre / colo names on the map (e.g. "Slough · LD4", "Aurora · CME colo"): confirm they don't imply Solace presence.
- In live mode, any latency or throughput number shown must be measured, or labelled illustrative.
- Nisshi performance numbers (S3 acks etc.): release-specific, internal until announced.

Added with the Kafka vs Solace section (all on-screen copy, review before external use):

- "Kafka can only order within one topic + partition" and "partitions can only be added, never removed": true of Kafka's partition model (the second is a documented limitation); confirm wording.
- Share groups (KIP-932): "production-ready in Kafka 4.2" is from the Apache Kafka 4.2.0 announcement. "No per-key ordering, no dead-letter queue, no retry backoff" is from a write-up of the **4.0 early-access** preview (Gunnar Morling); **not re-verified against 4.2**. Check before claiming it as current.
- KIP-848 incremental rebalance: GA in Kafka 4.0 (Apache docs); opt-in via `group.protocol=consumer`. "Classic rebalance stops the whole group" is the eager protocol's behaviour; the cooperative-sticky assignor mitigates it, so say "classic eager" and not "Kafka".
- Solace partitioned queues: "a partition handoff pauses only the affected partitions" was provided by the demo owner and matches the partition-rebalancing docs' intent, but the docs pages (Partition Rebalancing, Partition Handoff) were not fetched; **verify**. The "GA in 10.4.0" claim from search results is also unverified.
- Solace partition-count change: "service affecting", "removed partitions' messages are deleted", the key-to-partition mapping is not stored so keys can move, and the drain-first procedure all come from the Partition Scaling doc page (fetched).
- Exclusive / non-exclusive queue behaviour (active + standby, round-robin without ordering): from the demo owner and the Solace consumer-scaling blog; the Endpoints doc page was blocked and not read.
- Every duration and rate on the scaling tab is illustrative (see 3.5).

## 9. Open items

1. **Record headers in Nisshi**: not covered in the guide. Needed for the bridge expression. Test early (a 10-minute spike).
2. **Auth/TLS** between Solace Kafka Receiver and Nisshi: not documented in the guide. Affects whether Nisshi can safely sit on a public endpoint.
3. Solace Cloud service must be a version that supports Kafka bridging (docs mention 10.6.1+ for the non-beta feature); confirm the target service's version and region.
4. Header-based topic expressions are confirmed only by a community thread (AI-assisted answer, user reported success). Verify against the Solace docs for the Kafka Receiver before relying on it.
5. Is the Nisshi open-source announcement public yet (guide says internal until October)?
6. Brand overlay: runtime JSON (recommended) vs build-time. Runtime means an SE can reskin without Node installed.
7. Verify the Solace claims listed at the end of section 8 against the docs (partition handoff, GA version, queue types).
8. Kiosk (booth) mode only shows the open Kafka tab; it does not rotate through the three tabs. Decide whether it should.
9. Order-keyed partitioning: the scenarios' Kafka topics carry stock data only, so an order ID cannot be chosen as a partition key in the scaling tab. Add an order topic to a scenario if that story is wanted.
10. A `Bus`/`SimBus` abstraction and a `npm run new-scenario` scaffold are still not built.

Resolved: pause freezes everything (message flow and ambient animation), as requested 2026-11-19.

## 10. Progress log

**2026-11-17: phase 0 and the scenario type**

- `scripts/smoke.mjs` + `scripts/smoke/expect.capital-markets.json`: 51 checks across page, hero, and all nine sections (structure counts, "is it alive" checks, and interactions: topic filter, hub outage, Kafka and desk filters, slider, T and K shortcuts), plus zero console errors / failed requests. Screenshots in `smoke-out/`.
  - Verified it can fail: a broken `*` wildcard fails 2 checks, a broken `>` wildcard fails 9, and a dropped instrument plus an uncaught exception fails 3.
  - Needs Playwright (not a dependency): `npm i --no-save playwright && npx playwright install chromium`.
  - The expectations file is what "the demo is unchanged" means. A new scenario gets its own `expect.<id>.json`.
- `src/scenarios/`: `types.ts`, `bridge.ts`, `validate.ts`, `index.ts` (registry), and `capital-markets/index.ts` (the existing demo's values, extracted verbatim). **Nothing in the app imports these yet**, so the running demo is byte-for-byte the same behaviour; `tsc` type-checks them.
- Capital-markets scenario: 12 entities, 2 Kafka topics, 24 bridged topics + 360 lifecycle topics, all of which the validator proves are matched by every preset, persona subscription and architecture route.

**Next**: see the 2026-11-18 entry below.

**2026-11-17: retail & supply chain scenario**

- `src/scenarios/retail-supply-chain/index.ts`: 18 SKU-at-store entities across 9 stores and 5 regions, 2 Kafka topics (`stock.level`, `stock.movement`), a 9-stage order lifecycle (stock-out and cancel branches), a 12-node architecture (storefronts, OMS, inventory, WMS, TMS, suppliers, planning...), 9 sites, 6 consumers, 7 routing presets, and 8 sections (no latency).
- It validates clean: 36 bridged stock topics + 648 lifecycle topics, every preset, consumer subscription and diagram route matches real topics. A 100k-order walk of the lifecycle gives 92.0% delivered, 5.1% stock-out, 2.9% cancelled, about 7.6 events and 4.3 s per order.
- The self-test now covers both scenarios (29 mutations). `npm run smoke` is still 51/51, since the app does not read scenarios yet.
- **Not yet viewable**: retail only becomes visible once the sections are wired to read scenarios. It has no `expect.retail-supply-chain.json` yet for the same reason.
- Everything in it (stores, SKUs, sites) is invented. Service levels are generic; no carriers or retailers are named.

**2026-11-18: the app reads scenarios; retail is viewable**

- Open `?scenario=<id>` (a unique prefix works: `?scenario=retail`). No parameter = capital markets. The scenario is chosen once per page load (switching = reload). Unknown ids fall back to the default with a console warning.
- New engine, all driven by the scenario: `src/lib/scenario.ts` (context, `resolveScenario`, `useScenario`), `src/lib/sim/stream.ts` (entity random walk with optional mean reversion, published on the bridge-built topic), `src/lib/sim/lifecycle.ts` (state machine: stage delays, branches, repeats, progress), `src/lib/sim/records.ts` (Kafka-style records for the bridge and global views), `src/lib/rich.tsx` (`[[accent]]`/`**bold**`/`` `code` `` markup for copy).
- Removed `lib/market.ts`, `lib/orders.ts`, `lib/hubs.ts`; `content.ts` keeps only scenario-independent Solace claims (latency profiles, throughput, form factors, protocols). Hero text and the client strip moved into the scenario.
- Blotter columns come from `blotter.columns` (relative widths by `format`, optional `weight`); the grid is set with CSS variables whose defaults are the old finance values, so capital markets looks the same.
- `npm run smoke` is 51/51 on capital markets, and `scripts/smoke/expect.retail-supply-chain.json` is 48/48 on retail (`npm run smoke -- --scenario retail-supply-chain`). The smoke script's hub-outage click now targets the hub's core circle (clicking the group centre moved when the label text changed).
- Retail polish found by looking at screenshots: shorter hero headline, Kafka badges and label positions on the crowded North America map, fixed-width table columns with ellipsis, a wider label column in the Kafka filters.
- Still open: the `Bus` interface/`SimBus` (phase 1, not needed for sim), brand overlay (phase 4), logistics scenario, live mode, content-claims review. The North America cluster on the retail maps is still tight; consider moving a store region's hub if that shows up at the booth.

**2026-11-18 (later): retail feedback round**

- `Scenario.tape?: boolean`: the ticker tape is off for retail (it is a finance idiom). Default stays on.
- **Pause / resume**: press **P** or use the pause button in the nav. `src/lib/pause.ts` stops the producers (entity feed, order lifecycle, Kafka and Global views), freezes diagram and WAN particles, and pauses CSS animations; a "PAUSED" badge shows. In-flight orders wait and carry on at resume. The Throughput particle canvas and latency histogram keep running (ambient visuals, not message flow). Smoke checks it.
- **WAN for retail**: new hub kind `edge` (+ `sites.kindLabels` for the legend). Retail now shows 7 store-division edge brokers (Northeast, Midwest, South, West, UK & Ireland, Central Europe, SE Asia, with store counts) uplinked to 5 regional cloud brokers (N. Virginia, Portland, Dublin, Frankfurt, Singapore), which are meshed. Store Kafka ingest points to the regional cloud broker. Copy and consumers updated. Trans-Pacific links are avoided on purpose (the arc wraps across the map).
- **Inventory watch**: `watch.level` turns the watch list into an inventory view: ON HAND, a level bar against target stock, and a status (IN STOCK / LOW / REORDER, plus RESTOCKED for 4 s after a delivery). Retail entities use `value.sawtooth` (sales drain, delivery refills below the reorder point) instead of a random walk. Thresholds and labels are data; the validator checks them.
- Smoke: capital 52/52, retail 50/50. The hub-outage click now targets the last hub (the first retail hubs overlap on the map).

**2026-11-18 (later still): configurable Kafka partitioning**

- The Kafka cluster panel has live controls: **KEY** (the topic's headers, e.g. sku / store / category / region for retail) and **PARTS** (a +/- that shifts every topic's partition count by one, 1 to 12). The scenario's `partitions` and `keyBy` are the defaults. Changing either starts fresh logs, like re-creating the topic, and each topic shows its busiest partition ("busiest P3 34%") so key skew is visible (try `region`: five values spread over many partitions).
- Fix found on the way: the blotter's row keys restarted from 0 when the producer restarted, and its rows could linger after a filter change. Row ids now persist and the list resets with the subscription.
- Smoke: capital 53/53, retail 51/51 (new check: partition count and key are adjustable).

**2026-11-19: speed hotkeys**

- `]` / `+` / `=` faster, `[` / `-` / `_` slower, `\` resets. Levels 0.25, 0.5, 1, 2, 4, 8x. The nav shows the rate (click to reset). `src/lib/pause.ts` holds the state (`scaled(ms)` divides every producer delay); the entity feed, order lifecycle, Kafka and Global views and the comparison simulations all use it. Smoke checks that 4x moves more events than 1x (threshold 1.25x: a headless browser saturates before 4x is reachable).

**2026-11-19: Kafka vs Solace comparison, then one tabbed Kafka section**

- Research: Kafka 4.2 (Feb 2026) calls share groups (KIP-932) production-ready; KIP-848's incremental consumer rebalance is GA since 4.0; Solace partitioned queues documented (Partition Scaling page read; rebalancing/handoff pages not). Sources: Apache Kafka 4.2.0 announcement, Kafka KIP-848 docs, Morling's KIP-932 write-up, Solace Partition Scaling doc, Solace "consumer groups and consumer scaling" blog.
- Built `src/lib/sim/compare/` (pure models) and `src/components/Compare.tsx`; see 3.5 for what each tab shows. `scripts/compare-selftest.mjs` has 19 unit checks.
- Iterations driven by review: Solace partition resize no longer reorders events by default (drain first, with a "scale live" toggle to show the cost); queue-type switches reset the ordering memory; banners auto-clear after 5 s; added partition key + topic/subscription lines; per-item arrival-order strips and a router lane for the ordering story; per-app views (Kafka fetch-and-discard vs own topic + router, Solace narrowed subscription).
- Structure: Compare and the Kafka bridge were merged into one section with tabs (`src/components/Kafka.tsx`). `SectionId` lost `compare`; `SectionCopy` gained `extra` (the Bridge tab intro). The scenario `copy.kafka` is now the "Kafka vs Solace" heading.
- Validator: the bridge must use at least 2 header levels and the first topic must carry at least 2 headers (the tabs build needs, keys and views from them). Self-test is 47 checks.
- Smoke: capital 83/83, retail 79/79 (the Kafka section checks cover all three tabs).
- Authoring guide added: [NEW-SCENARIO.md](NEW-SCENARIO.md).
- Dev-process note: a delivery step once left stale copies of two files on the device (the page failed to load). Verify with a checksum of the source tree after delivering, and deliver changed files under fresh names.
