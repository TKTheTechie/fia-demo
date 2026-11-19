# Building a new industry scenario

A scenario is one TypeScript file of **plain data**. It tells the demo what the business is (stores, flights, meters), which Kafka topics carry its data, what the Solace topic hierarchy looks like, what the tracked process is (order, shipment, flight), where the sites are, and what each section says. No React is needed. Everything is invented demo data.

Plan on 2 to 4 hours for the first one (most of it is design, not typing), and under an hour once you have done one. This guide is written so a person or an LLM can follow it from a blank page.

What you will produce:

| File | What it is |
|---|---|
| `src/scenarios/<id>/index.ts` | the scenario (data only) |
| one line in `src/scenarios/index.ts` | registers it |
| `scripts/smoke/expect.<id>.json` | what the smoke test should find on the page |

The two built-in scenarios are the best references: `src/scenarios/capital-markets/index.ts` (prices, trading) and `src/scenarios/retail-supply-chain/index.ts` (inventory, orders, store-edge WAN). Retail is the closer model for most non-finance industries. The type, with comments on every field, is `src/scenarios/types.ts`, and it is the source of truth. This guide explains how to fill it in and what the validator will insist on.

---

## 1. Quick start

```bash
cp -r src/scenarios/retail-supply-chain src/scenarios/<your-id>      # <your-id> is kebab-case, e.g. logistics
```

1. Edit `src/scenarios/<your-id>/index.ts`: rename the export and change `id`, `title`, `vertical`, then work through section 3 below.
2. Register it in `src/scenarios/index.ts`:
   ```ts
   import { logistics } from './logistics/index.ts'
   export const SCENARIOS: Scenario[] = [capitalMarkets, retailSupplyChain, logistics]
   ```
3. Validate as you go (fast, no browser): `npm run check:scenarios -- <your-id>` (add `--topics` to list every topic it can emit).
4. Look at it: `npm run dev`, then open `http://localhost:5173/?scenario=<your-id>` (a unique prefix works).
5. Write the smoke expectations (section 5) and run `npm run smoke -- --scenario <your-id>`.

Import rules, because Node runs these files directly for the validator: use `.ts` extensions in imports and `import type` for types.

---

## 2. Design before you type (one page of notes)

Answer these first. Every later choice follows from them.

1. **The tracked thing.** What do you watch a value of? (a SKU's stock, a vehicle's speed, a meter's load). That is the *entity*. 12 to 18 entities is right; fewer looks empty, more is clutter.
2. **Three dimensions of an entity.** Each entity has a `group` (a category: product family, vehicle class), an `origin` (where it lives: store, depot, plant) and an `id`. Add `attrs` for any further dimension you need in topics (region, tier).
3. **The Solace topic hierarchy.** Order levels from **general to specific**, because wildcards work on levels left to right. Example: `retail/stock/{region}/{store}/{category}/{sku}/{level|movement}`. Put the dimensions people filter on in the middle. The event *type* goes last.
4. **The flat Kafka topics.** Kafka has no hierarchy, so the type goes in the topic name and the dimensions go in record **headers** (`stock.level`, `stock.movement`). 2 topics is plenty. These are what the Kafka tabs compare against.
5. **The process.** One thing that moves through stages over seconds: order (PLACED → PICKING → PACKED → SHIPPED → DELIVERED), shipment, flight, work order. Include at least one branch (a stock-out, a delay, a scrap). That is the live tracker.
6. **The sites.** 5 to 12 places on a world map the data lives or is consumed: data centers, cloud regions, and for edge-heavy industries (retail, energy) edge brokers that uplink to regional clouds.
7. **The consumers.** 4 to 6 teams or systems that would each want a precise slice (the "personas"), one per site, and 5 to 7 example subscriptions (the "presets").
8. **The story.** One sentence per section that a salesperson would say out loud.

Rules for content:

- **Invent everything.** Store names, SKUs, site names, carriers, airlines. Do not use real customer names or logos (the optional client strip needs documented permission; leave it out by default).
- **Healthcare and similar:** device and department tokens only. Never patient identifiers, even synthetic-looking ones, in topics or payloads.
- Don't name a data center or colo in a way that implies Solace has a presence there.
- Numbers that appear on screen are illustrative. Say so if asked.

---

## 3. The file, top to bottom

Fields in the order they appear in the type. Constraints marked **(validator)** are checked by `npm run check:scenarios`.

### Identity
- `id`: kebab-case; it is the URL name and the smoke file name **(validator)**.
- `title`, `vertical`: shown in the UI.
- `topicRoots`: the first topic level of everything you publish, e.g. `['retail']`. Every generated topic must start with one **(validator)**.
- `tape`: `false` hides the stock-ticker-style tape. It is a finance idiom; turn it off unless you have prices.

### Hero and copy
- `hero`: `eyebrow`, a **two-line** `title`, `lede`. Keep each title line short: a long headline wraps onto extra lines (retail's was shortened for this reason). `clients` is optional.
- `sections`: which sections appear and in what order. Pick from `flow`, `topics`, `latency`, `wan`, `throughput`, `hybrid`, `kafka`, `global`, `blotter`. Numbering in the UI follows this order. `latency` is finance-flavoured, so non-finance scenarios usually omit it.
- `copy`: for every listed section: `eyebrow` (small label), `title`, `lede`, and `nav` (a short nav label, 1 or 2 words).
  - Markup: `[[text]]` gradient accent, `**text**` bold, `` `text` `` code. Use `[[...]]` on the punchy phrase of each title.
  - The `kafka` copy is the "Kafka vs Solace" heading. Its `extra` field is the intro paragraph shown on the **Kafka bridge** tab (describe your Kafka data landing on flat topics and the bridge turning it into your hierarchy).

### Entities (`model`)
```ts
labels: { id: 'SKU', group: 'Category', origin: 'Store' },   // words used in copy and legends
entities: [{ id: 'GRO-1042', group: 'GROCERY', origin: 'NYC-01',
             attrs: { region: 'NA-EAST' },
             value: { start: 400, decimals: 0, volatility: 0.02 /* optionally: meanReversion, sawtooth */ },
             params: { orderLot: 1 } }]
```
- `id` unique; `group` and `origin` required **(validator)**.
- `value.start` > 0 is the starting (or target) value; `volatility` is the size of each random step.
- Price-like values: `volatility` is the relative size of each random step (look at the last argument of `inst(...)` in the capital-markets file for real values); optional `meanReversion` (0 to 1) pulls each update back toward `start`.
- Inventory-like values: add `sawtooth: { drain, reorder, refill }` (retail uses 0.012, 0.12, 1): each update drains `drain × start`, below `reorder × start` it refills to about `refill × start` **(validator: `0 < reorder < refill`)**.
- Every entity must define every `attrs.<name>` that a Kafka header references **(validator)**.
- Spread the entities across at least 2 values of the first Kafka header (for example 2+ regions), or the topic and view demos have nothing to show.

### Watch list (`watch`)
- `title`, and `columns`: 1 or 2 column labels **(validator)**.
- For inventory-style values add `level: { capacity, low, critical, labels: { ok, low, critical, restock } }`. It turns the table into a level bar against `start`. Needs `0 < critical < low < 1 < capacity` **(validator)**.

### Kafka (`kafka`): the part customers ask about most
```ts
topics: [
  { name: 'stock.level', partitions: 8, keyBy: 'id',
    headers: { region: 'attrs.region', store: 'origin', category: 'group', sku: 'id' },
    weight: 0.75, render: 'value' },
  { name: 'stock.movement', partitions: 4, keyBy: 'id', headers: { /* same keys */ }, weight: 0.25, render: 'delta' },
],
bridge: { segments: [{ literal: 'retail' }, { literal: 'stock' }, { header: 'region' }, { header: 'store' },
                     { header: 'category' }, { header: 'sku' }, { topicSuffix: 'stock.' }] },
ui: { chipHeader: 'category', chipLabel: 'CATEGORY', chips: [{ id: 'GROCERY', label: 'Grocery' } /* 1 to 5 */],
      typeLabel: 'TYPE', idHeader: 'sku', idLabel: 'SKU', idPlaceholder: '* or GRO*',
      originLabel: 'STORE', valueLabel: 'UNITS', extra: { label: 'REGION', header: 'region' } },
```
- `name` shares a prefix and the bridge strips it with `topicSuffix`, so `stock.level` becomes the last topic level `level` **(validator: the prefix must match)**.
- `headers` maps a header name to an entity field: `id`, `group`, `origin`, or `attrs.<name>` **(validator)**.
- `weight`s sum to 1 **(validator)**. `render` is `bidask`, `value` or `delta`.
- `bridge.segments` builds the Solace topic from literals, headers and the topic suffix. One definition drives both the browser emulation and the real Kafka Receiver expression. **The segments may only use headers every topic carries (validator).**
- **The comparison tabs need at least 2 header levels in the bridge and at least 2 headers on the first topic (validator).** The tabs generate their consumers, partition-key choices and views from your data, with nothing extra to author. **Topics & ordering** builds its consumers from the bridge's header levels in order: the first header (e.g. region), the second (e.g. store), the last (e.g. one SKU across every event type), and the last Kafka topic's event type. **Consumer scaling** uses the first Kafka topic, offers its headers (in order) as partition-key choices, and builds its per-app views from its first two headers. Choose headers that make sensible partition keys (a high-cardinality one such as a SKU, a medium one such as a store, and a low one such as a region).
- `ui.chips`: 1 to 5 entries, one per distinct value of `chipHeader`; every entity's value must have a chip **(validator)**.

### Lifecycle (the process tracker)
```ts
lifecycle: {
  noun: 'order', idPrefix: 'ORD', qty: [1, 6],
  pattern: 'retail/order/{stage}/{channel}/{origin}/{id}',   // {stage} {origin} {id} plus your facets
  facets: { channel: ['web', 'app', 'store', 'marketplace'] },       // in the topic
  attributes: { service: ['standard', 'express'] },                  // NOT in the topic, shown as columns
  stages: [
    { id: 'oms/placed',  status: 'PLACED',  delayMs: [200, 500], next: 'wms/picking' },
    { id: 'wms/picking', status: 'PICKING', delayMs: [800, 1600], branches: [{ to: 'oms/stockout', p: 0.05 }], next: 'wms/packed' },
    // ... terminal stages have no `next`
  ],
  statuses: [{ id: 'PLACED', tone: 'new' }, /* ack | partial | done | bad */],
}
```
- Stage `id`s must all have the **same number of `/` levels** (the blotter filter relies on it) **(validator)**.
- At least one terminal stage (no `next`, no `branches`); every `next` and branch target must exist; branch probabilities sum to at most 1; delays are `[min, max]` ms; `repeat: [min, max]` makes a stage repeat (partial fills); `progress` 0 to 1 sets how fulfilled the item is **(validator)**.
- Each stage's `status` must be listed in `statuses`; `tone` is one of `new`, `ack`, `partial`, `done`, `bad` **(validator)**.
- The `pattern` may only use `{stage}`, `{origin}`, `{id}` and your facets **(validator)**.
- Every topic it can emit must start with a `topicRoots` entry and be a valid topic **(validator)**.

### Architecture diagram
12 nodes in a 6 × 2 grid: `x` = 100, 300, 500, 700, 900, 1100 on each of two rows (`'top'`, `'bot'`).
```ts
{ id: 'oms', label: 'Order Mgmt', sub: 'orders · allocation', x: 500, row: 'top', color: 'var(--brand)', icon: '☰' }
```
- `color` is a CSS variable: `--brand`, `--cyan`, `--violet`, `--amber`, `--sell`, `--buy`. `icon` is one character.
- `routes`: each one is a subscription that triggers an animation along `hops` (pairs of node ids). `sample` (0 to 1) is the share of matching events that spawn a particle. Use 1 for rare, important events and about 0.35 for high volume. An optional `lead` draws a hop first (for example supplier → ingest).
- Every route subscription must match at least one topic you publish, and every hop node must exist **(validator)**.

### Sites (WAN map and global view)
```ts
hubs: [{ id: 'NYC', name: 'N. Virginia', dc: 'cloud region', lon: -77.5, lat: 38.9, kind: 'cloud', label: 'l' }],
links: [['NYC', 'DUB']],
ingest: { 'NYC-01': 'NYC' },        // every entity origin -> the hub that ingests its Kafka data
```
- `kind`: `colo`, `cloud`, `dc` or `edge`. `kindLabels` renames the legend (retail: `edge: 'Store division'`). `label` positions the name (`l`, `r`, `bl`, `br`, `tl`).
- The link graph must be **connected**, links unique, hub ids unique, and every entity origin needs an `ingest` entry **(validator)**.
- For edge-heavy industries use `edge` hubs uplinked to a few `cloud` hubs that are meshed together (this is the retail layout).
- Look at the map: hubs that are close together overlap their labels (use `label` to push them apart, or move one). Avoid a link that crosses the Pacific, because the arc wraps the wrong way round the map.
- `kafkaBadge` nudges the "K" badge on a crowded hub, as `[dx, dy]`.

### Consumers, presets, hybrid, blotter
- `personas`: `{ id, site, city, role, subs: [...] }`, 4 to 6, one per site (the map shows one per site; the validator warns otherwise). `subs` are the subscriptions the persona cycles through. Each must match something you publish **(validator)**. `consumerNoun` is what a persona is called ("Equities desk", "Store team").
- `presets`: 5 to 7 `{ sub, desc }` shown as chips in Topic routing. Make them a ladder: everything in a region, one store, one category across all regions, one event type.
- `hybrid`: exactly 3 on-prem and 3 cloud labels **(validator)**.
- `blotter`: `title`, `allLabel` (the "no filter" chip), `facet` (a lifecycle facet the chips filter on **(validator)**), `kpis: { total, done, bad, value? }` labels, and `columns: [{ key, label, format }]`. A column `key` is a built-in (`id`, `entity`, `origin`, `group`, `status`, `qty`, `filled`, `avgValue`), a lifecycle facet or a lifecycle attribute. `format` is one of `id`, `side`, `text`, `int`, `progress`, `price`, `status`. `weight` sets relative width and `hideSmall` hides it on narrow screens.

---

## 4. Register and look at it

```bash
npm run check:scenarios -- <your-id>          # errors must be 0; read the warnings
npm run check:scenarios -- <your-id> --topics # see every topic it can emit
npm run dev                                   # open /?scenario=<your-id>
```

Walk every section with fresh eyes. Things that have needed fixing in past scenarios: a hero title that wraps to three lines, overlapping hub labels, a persona subscription that matches nothing, and a lede that still talks about the scenario you copied from.

In the Kafka section check all three tabs: the consumer names read sensibly (they are generated from your headers), the partition-key chips are real choices, and the Kafka bridge tab shows your hierarchy.

---

## 5. Smoke expectations

The smoke test drives every section in headless Chromium and compares what it finds with `scripts/smoke/expect.<id>.json`. Start by copying the retail file and editing the numbers:

```bash
cp scripts/smoke/expect.retail-supply-chain.json scripts/smoke/expect.<id>.json
npm i --no-save playwright && npx playwright install chromium       # once
npm run smoke -- --scenario <id>                                    # it tells you what differs
```

What each count is:

| Section | Selector | Equals |
|---|---|---|
| `page` | `.nav-links a`, `section.fit` | the number of sections; `.tape-item` is 0 if `tape: false` |
| `flow` | `.arch-node` | number of nodes (12) |
| `topics` | `.presets .chip` | number of presets |
| `wan` | `.wan-hub`, `.wan-arc` | hubs, links |
| `kafka` | `.kb-topic`, `.kb-part` | Kafka topics, sum of their partitions |
| `global` | `.gd-desk`, `.gd-hub`, `.gd-hub.desk`, `.gd-arc` | personas, hubs, personas, links |
| `blotter` | `.mw tbody tr`, `.desk-chips .chip` | entities, facet values + 1 |

`interact` holds the values the interaction checks use (a topic to type, a chip to click, its expected subscription, the slider setting). Edit them to names that exist in your scenario. Keep the `live` checks (they confirm things are moving). `soft` checks warn rather than fail.

Fix real problems in the scenario, not in the expectations. Exceptions are the counts and names above.

---

## 6. Review checklist before it goes in front of anyone

- [ ] `npm run check:scenarios` has 0 errors and you have read the warnings.
- [ ] `npm run smoke -- --scenario <id>` passes with 0 failures.
- [ ] Every name, site, SKU and number is invented; no real customers or logos; no patient identifiers.
- [ ] Copy: each section's title has a `[[...]]` accent; ledes talk about *this* industry; nothing left over from the scenario you copied.
- [ ] Claims: anything beyond the shared Solace claims in `src/content.ts` is reviewed (see section 8 of [DESIGN.md](DESIGN.md)).
- [ ] You looked at every section and all three Kafka tabs on a real screen, in dark and light (`T`).
- [ ] Booth test: it runs for 10 minutes without anything piling up; try pause (`P`) and the speed keys.

---

## 7. Validator errors you will meet

| Message (shortened) | Usually means |
|---|---|
| `kafka topic weights sum to …` | `weight`s do not add up to 1 |
| `bridge uses header "x" which kafka topic "…" does not carry` | a segment names a header some topic lacks |
| `bridge strips "…" which kafka topic "…" does not start with` | `topicSuffix` does not match the topic name prefix |
| `entities have chipHeader="…" but kafka.ui.chips has no chip` | an entity value has no chip (max 5 chips) |
| `kafka.bridge needs at least 2 header segments` | the comparison tabs need two levels to pin and key on |
| `entity origin "…" has no entry in sites.ingest` | map every origin to a hub |
| `site graph is not connected` | a hub has no link path to the first hub |
| `… matches no topic this scenario publishes` | an architecture route, persona or preset subscription is dead; check it against `--topics` |
| `lifecycle stage ids must all have the same number of "/" levels` | use the same depth for every stage id |
| `status "…" is not in lifecycle.statuses` | declare every status you use |
| `blotter column "…" is not a built-in column, lifecycle facet or lifecycle attribute` | fix the `key` |
| `generates an invalid topic` | a value contains `/`, `*`, `>` or is empty |

The validator's own tests are `npm run selftest:scenarios`; if you add a rule, add a mutation there.

---

## 8. Using an LLM to draft one

Give it `src/scenarios/types.ts`, `src/scenarios/retail-supply-chain/index.ts` and this file, then a brief such as:

> Write `src/scenarios/<id>/index.ts` for **<industry>**. Entities: <what is tracked>, about 16, across <N> origins and <M> regions. Solace topic hierarchy (general to specific): `<root>/<domain>/{…}/…`. Two flat Kafka topics: `<a>`, `<b>`, with headers `<…>`. Process: <stages and one or two branches>. Sites: <list>. Consumers: <list>. Invent every name; no real companies, no personal data. Follow section 3 of docs/NEW-SCENARIO.md and make `npm run check:scenarios` pass with 0 errors.

Then run the validator, give it any errors verbatim, and review the copy yourself: models are good at the structure and weaker at what is credible to a specific industry's practitioners.
