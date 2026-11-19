# Solace · FIA Expo booth demo

A single-page, fully animated showcase of the Solace event mesh for capital markets.
Everything on the page runs off a small in-browser topic broker (`src/lib/broker.ts`) with
Solace-style wildcards (`*`, `>`, prefix `E*`). Simulated feed handlers and an OMS → risk → EMS → venue
order lifecycle publish onto it, and every visual subscribes to it.

| Section | What it shows |
|---|---|
| Hero | WebGL event-mesh globe (react-three-fiber) with live page event counters |
| End-to-end | Exchanges, feed handlers, pricing, algo/SOR, risk, UIs, OMS, EMS, FIX, post-trade, TCA, surveillance — particles are real bus events |
| Topic routing | Type any subscription and watch broker-side filtering live |
| Low latency | Streaming log-scale latency histogram + "race a message" |
| WAN routing | World map of colo/cloud brokers; click a hub to simulate an outage |
| Throughput | Particle firehose with a load slider |
| Multi-form factor / hybrid | Appliance, software, cloud, edge + on-prem ↔ cloud mesh |
| Kafka (three tabs) | **Topics & ordering** and **Consumer scaling** compare Kafka and Solace side by side (interactive: add consumers, partitions, queue types, group protocols). **Kafka bridge**: flat Kafka topics → Solace Kafka bridge → hierarchical topics → filterable WebSocket blotter |
| Global distribution | Regional Kafka clusters bridged into the mesh; trader blotters in 6 cities each subscribe to precise streams, routed over WAN only on demand |
| Live blotter | Animated order blotter (desk filter = topic subscription) + market watch with sparklines |

## Booth controls

- **Booth mode** button or `K` — auto-tours sections every 12 s, pauses on touch, resumes after 45 s idle. Open with `?kiosk` to start in booth mode.
- `T` — toggle dark/light (circular wipe in Chromium) · `F` — fullscreen
- `P` — pause / resume all message flow · `]` or `+` faster · `[` or `-` slower · `\` reset speed (0.25× to 8×; the nav shows the rate)

## Editing claims

All marketing copy and the illustrative latency / throughput figures live in `src/content.ts`.
**Check them against current Solace benchmarks and brand guidelines before the show.**

## Develop

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Create a GitHub repo and push this folder to `main`.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push.

The Vite `base` is relative (`./`), so it works at `user.github.io/<repo>/` with no changes.

## Checks

```bash
npm run check:scenarios       # validate every scenario in src/scenarios (add --topics to list the topics each can emit)
npm run selftest:scenarios    # prove the validator catches broken scenarios
npm run smoke                 # build, serve, and drive every section in headless Chromium (screenshots in smoke-out/)
npm run selftest:compare      # unit checks for the Kafka-vs-Solace simulation models (src/lib/sim/compare)
```

`smoke` needs Playwright, which is deliberately not a dependency:
`npm i --no-save playwright && npx playwright install chromium`.
Options: `--no-build`, `--url http://localhost:5173` (test a running dev server), `--scenario <id>`, `--expect <file>`, `--out <dir>`, `--headed`.

## Scenarios (work in progress)

This repo is being refactored from a single capital-markets booth demo into a reusable demo kit.
See [docs/DESIGN.md](docs/DESIGN.md). The scenario type is in `src/scenarios/types.ts`; the
capital-markets demo is expressed as data in `src/scenarios/capital-markets/`, and a second scenario
(retail & supply chain) is in `src/scenarios/retail-supply-chain/`. The running app reads them:

```
npm run dev
# http://localhost:5173/                              capital markets (default)
# http://localhost:5173/?scenario=retail-supply-chain  retail & supply chain (a unique prefix works: ?scenario=retail)
```

To build a new industry scenario, follow [docs/NEW-SCENARIO.md](docs/NEW-SCENARIO.md).

Test another scenario with `npm run smoke -- --scenario retail-supply-chain` (uses `scripts/smoke/expect.<id>.json`).
