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
| Live blotter | Animated order blotter (desk filter = topic subscription) + market watch with sparklines |

## Booth controls

- **Booth mode** button or `K` — auto-tours sections every 12 s, pauses on touch, resumes after 45 s idle. Open with `?kiosk` to start in booth mode.
- `T` — toggle dark/light (circular wipe in Chromium) · `F` — fullscreen

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
