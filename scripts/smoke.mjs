#!/usr/bin/env node
// Smoke test: build, serve, then drive the real app in headless Chromium.
//
// For each section it checks that the expected structure is on the page (counts), that the
// live parts are actually alive (events flowing, tables filling), and that the interactive
// bits work (topic filtering, outage click, filters, slider, keyboard shortcuts). Any console
// error, uncaught exception or failed request fails the run. Screenshots land in smoke-out/.
//
// It exists so the scenario refactor can be checked after every step: while the demo must
// stay identical, `npm run smoke` must stay green. What "identical" means is written down in
// scripts/smoke/expect.<scenario>.json.
//
//   npm run smoke                      build + test
//   npm run smoke -- --no-build        reuse dist/
//   npm run smoke -- --url http://localhost:5173   test a server you already run (e.g. npm run dev)
//   npm run smoke -- --scenario retail-supply-chain    test another scenario (opens ?scenario=<id>, uses expect.<id>.json)
//   npm run smoke -- --headed          watch it run
//
// Needs Playwright (not a project dependency, to keep installs light):
//   npm i --no-save playwright && npx playwright install chromium
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---- args
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const scenarioId = opt('scenario', 'capital-markets')
const expectFile = path.resolve(root, opt('expect', `scripts/smoke/expect.${scenarioId}.json`))
function ex_missing(f) { try { readFileSync(f); return false } catch { return true } }
const outDir = path.resolve(root, opt('out', 'smoke-out'))
const port = Number(opt('port', '4173'))
const externalUrl = opt('url', '')
if (ex_missing(expectFile)) { console.error(`No expectations for scenario "${scenarioId}": ${path.relative(root, expectFile)} does not exist.`); process.exit(2) }
const ex = JSON.parse(readFileSync(expectFile, 'utf8'))

// ---- playwright
let chromium
for (const name of ['playwright', 'playwright-core']) {
  try { ({ chromium } = require(name)); break } catch { /* try next */ }
}
if (!chromium) {
  console.error('Playwright is not installed.\n  npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

// ---- build
if (!externalUrl && !flag('no-build')) {
  console.log('> npm run build')
  const b = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (b.status !== 0) { console.error('\nBuild failed (this includes the TypeScript check).'); process.exit(1) }
}

// ---- server
let server
const rootUrl = externalUrl || `http://127.0.0.1:${port}/`
const baseUrl = `${rootUrl}${rootUrl.includes('?') ? '&' : '?'}scenario=${scenarioId}`
async function startServer() {
  if (externalUrl) return
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', (d) => (log += d))
  server.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(rootUrl)).ok) return } catch { /* not up yet */ }
    if (server.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview server did not start on ${rootUrl}\n${log}`)
}

// ---- results
const results = []
const record = (section, name, ok, detail = '', soft = false) => {
  results.push({ section, name, ok, detail, soft })
  const mark = ok ? '  ✓' : soft ? '  ~' : '  ✗'
  console.log(`${mark} ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function poll(fn, timeout = 12000, every = 250) {
  const t0 = Date.now()
  let v
  for (;;) {
    v = await fn()
    if (v.ok || Date.now() - t0 > timeout) return v
    await sleep(every)
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  for (const f of ['report.json']) rmSync(path.join(outDir, f), { force: true })
  await startServer()

  const browser = await chromium.launch({
    headless: !flag('headed'),
    // software GL so the WebGL globe renders on machines without a GPU (CI, containers)
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

  const problems = []
  const ignore = (ex.ignoreConsole ?? []).map((s) => new RegExp(s))
  page.on('console', (m) => { if (m.type() === 'error' && !ignore.some((r) => r.test(m.text()))) problems.push(`console.error: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`))
  page.on('requestfailed', (r) => { if (!(r.failure()?.errorText ?? '').includes('ABORTED')) problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`) })
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`) })

  const $count = (sel) => page.locator(sel).count()
  const $text = async (sel) => ((await page.locator(sel).first().textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim()
  const $num = async (sel) => parseFloat((await $text(sel)).replace(/[^0-9.]/g, ''))
  const goTo = async (id) => {
    await page.evaluate((i) => {
      const el = document.getElementById(i)
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' })
    }, id)
    await sleep(1400) // reveal animations
  }
  const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

  console.log(`\nScenario: ${ex.scenario}   ${baseUrl}\n`)
  await page.goto(baseUrl, { waitUntil: 'load' })
  await sleep(800)

  // ---- page-level structure + keyboard shortcuts
  console.log('page')
  for (const [sel, n] of Object.entries(ex.counts.page ?? {})) {
    const c = await $count(sel)
    record('page', `${sel} × ${n}`, c === n, c === n ? '' : `found ${c}`)
  }
  const theme0 = await page.evaluate(() => document.documentElement.dataset.theme)
  await blur(); await page.keyboard.press('t')
  const th = await poll(async () => { const t = await page.evaluate(() => document.documentElement.dataset.theme); return { ok: t !== theme0, t } }, 3000)
  record('page', 'T toggles theme', th.ok, `${theme0} → ${th.t}`)
  await page.keyboard.press('t'); await sleep(600)
  await page.keyboard.press('k')
  const k1 = await poll(async () => { const c = (await page.getAttribute('[data-kiosk-toggle]', 'class')) ?? ''; return { ok: /\bon\b/.test(c) } }, 3000)
  await page.keyboard.press('k')
  const k2 = await poll(async () => { const c = (await page.getAttribute('[data-kiosk-toggle]', 'class')) ?? ''; return { ok: !/\bon\b/.test(c) } }, 3000)
  record('page', 'K starts and stops booth mode', k1.ok && k2.ok)
  // P pauses and resumes the message flow
  const total = () => $num('.hero-stats .stat:nth-child(2) b')
  await blur(); await page.keyboard.press('p'); await sleep(900)
  const paused = await page.evaluate(() => 'paused' in document.documentElement.dataset)
  const p1 = await total(); await sleep(1500); const p2 = await total()
  await page.keyboard.press('p'); await sleep(1500)
  const p3 = await total()
  record('page', 'P pauses message flow and P resumes it', paused && p1 === p2 && p3 > p2, `paused ${p1} → ${p2}, resumed → ${p3}`)

  // ] and [ change the message rate, \\ resets it
  const rateOver = async (ms) => { const a = await total(); await sleep(ms); return (await total()) - a }
  await sleep(600)
  await page.keyboard.press('[')
  const slowLabel = await $text('.pill-btn.speed')
  await sleep(600)
  const slow = await rateOver(3000)
  await page.keyboard.press(']'); await page.keyboard.press(']'); await page.keyboard.press(']')
  const label = await $text('.pill-btn.speed')
  await sleep(600)
  const fast = await rateOver(3000)
  await page.keyboard.press('\\')
  const reset = await $text('.pill-btn.speed')
  record('page', '] speeds up, [ slows down, \\ resets the message rate', label.trim() === '4×' && fast > slow * 1.5 && reset.trim() === '1×' && slowLabel.trim() === '0.5×', `0.5x: ${slow} events/3s, 4x: ${fast}; labels ${label.trim()} / ${reset.trim()} / ${slowLabel.trim()}`)

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))

  // ---- per section
  let n = 0
  for (const id of ex.sections) {
    n++
    console.log(`\n${id}`)
    await goTo(id)
    if (id === 'kafka') { await page.locator('[data-tab="bridge"]').click(); await sleep(700) } // the section opens on Topics; the bridge checks need its tab

    for (const [sel, want] of Object.entries(ex.counts[id] ?? {})) {
      const c = await $count(sel)
      record(id, `${sel} × ${want}`, c === want, c === want ? '' : `found ${c}`)
    }
    for (const [sel, want] of Object.entries(ex.soft?.[id] ?? {})) {
      const c = await $count(sel)
      record(id, `${sel} × ${want}`, c === want, c === want ? '' : `found ${c} (warning only)`, true)
    }
    for (const l of ex.live?.[id] ?? []) {
      const r = await poll(async () => {
        if ('minCount' in l) { const c = await $count(l.sel); return { ok: c >= l.minCount, v: c } }
        if ('maxCount' in l) { const c = await $count(l.sel); return { ok: c <= l.maxCount, v: c } }
        if ('minNumber' in l) { const v = await $num(l.sel); return { ok: v >= l.minNumber, v } }
        const t = await $text(l.sel); return { ok: t !== '' && t !== l.notText, v: t }
      }, l.timeoutMs ?? 15000)
      record(id, `live: ${l.what}`, r.ok, `${l.sel} → ${r.v}`)
    }
    await page.screenshot({ path: path.join(outDir, `${String(n).padStart(2, '0')}-${id}.png`) })

    // ---- interactions (each leaves the section as it found it, or close enough)
    const I = ex.interact ?? {}
    if (id === 'topics' && I.topicRouting) {
      const t = I.topicRouting
      await page.locator('.topic-input input').fill(t.sub)
      const r = await poll(async () => {
        const rows = await page.locator('.srow.hit').allTextContents()
        const top = rows.slice(0, 3)
        return { ok: top.length === 3 && top.every((x) => x.includes(t.everyDeliveredContains)), v: top.length }
      })
      record(id, `typing "${t.sub}" delivers only matching topics`, r.ok, `newest delivered rows: ${r.v}`)
    }
    if (id === 'kafka') {
      await page.locator('[data-tab="topics"]').click(); await sleep(700)
      await page.screenshot({ path: path.join(outDir, `${String(n).padStart(2, '0')}-kafka-topics.png`) })
      record(id, 'Kafka section has three tabs and Topics shows one act', (await $count('[data-tab]')) === 3 && (await page.locator('[data-act="topics"]').isVisible()) && !(await page.locator('[data-act="scaling"]').isVisible()) && !(await page.locator('[data-pane="bridge"]').isVisible()))
      const consumers = () => $count('[data-act="topics"] [data-side="kafka"] [data-consumer]')
      const c0 = await consumers()
      await page.locator('[data-need="p2"]').click(); await page.locator('[data-need="multi"]').click(); await sleep(600)
      const c1 = await consumers()
      record(id, 'ADD CONSUMER adds a consumer to both sides', c1 === c0 + 2 && (await $count('[data-act="topics"] [data-side="solace"] [data-consumer]')) === c1, `${c0} → ${c1}`)
      await page.locator('[data-strategy="republish"]').first().click(); await sleep(600)
      record(id, 're-publish strategy shows the router topic', (await $text('[data-act="topics"] [data-side="kafka"] .cmp-sub')).includes('router'))
      const ooo = await poll(async () => { const v = await $num('[data-k-ooo]'); return { ok: v > 0, v } }, 25000)
      record(id, 'Kafka shows out-of-order events across topics', ooo.ok, `out of order: ${ooo.v}`, true)
      record(id, 'Solace shows 0 out-of-order and 0% discarded', (await $text('[data-s-ooo]')).trim() === '0' && (await $text('[data-s-waste]')).trim() === '0%')
      const tr = await poll(async () => { const k = await $count('[data-trace="kafka"] .cmp-tchips span:not(.cmp-hint)'); return { ok: k >= 3 && (await $count('[data-trace="solace"] .cmp-tchips span:not(.cmp-hint)')) >= 3, v: k } }, 20000)
      record(id, 'Act 1 shows each side\'s arrival order for one item', tr.ok, `${tr.v} events traced`)
      const late = await poll(async () => ({ ok: (await $count('[data-trace="kafka"] .late')) > 0 }), 30000)
      record(id, 'Kafka arrival order shows late (out-of-order) events', late.ok, '', true)
      record(id, 'Solace arrival order never shows a late event', (await $count('[data-trace="solace"] .late')) === 0)
      const aligned1 = await page.evaluate(() => [...document.querySelectorAll('[data-act="topics"] [data-side="kafka"] [data-consumer]')].map((k) => {
        const sd = document.querySelector(`[data-act="topics"] [data-side="solace"] [data-consumer="${k.dataset.consumer}"]`)
        return Math.abs(k.getBoundingClientRect().top - sd.getBoundingClientRect().top) <= 1
      }))
      record(id, 'Each consumer row is aligned across the Kafka and Solace cards', aligned1.length >= 3 && aligned1.every(Boolean), JSON.stringify(aligned1))
      await page.locator('[data-strategy="republish"]').first().click(); await sleep(500)
      record(id, 'Re-publish shows the router lane', (await $count('[data-router]')) >= 1)
      await page.locator('[data-strategy="fetch-discard"]').first().click()
      const waste = await poll(async () => { const t = await $text('[data-k-waste]'); return { ok: t !== '' && t.trim() !== '0%', v: t } }, 20000)
      record(id, 'Kafka consumers fetch events they discard', waste.ok, waste.v)
      // Act 2
      await page.locator('[data-tab="scaling"]').click(); await sleep(700)
      await page.screenshot({ path: path.join(outDir, `${String(n).padStart(2, '0')}-kafka-scaling.png`) })
      record(id, 'Consumer scaling tab shows 3 apps on each side', (await $count('[data-kapp]')) === 3 && (await $count('[data-sapp]')) === 3)
      const aligned = await page.evaluate(() => [...document.querySelectorAll('[data-kapp]')].map((k) => {
        const sd = document.querySelector(`[data-sapp="${k.dataset.kapp}"]`)
        const t = (e) => Math.round(e.getBoundingClientRect().top), h = (e) => Math.round(e.getBoundingClientRect().height)
        return Math.abs(t(k) - t(sd)) <= 1 && Math.abs(h(k) - h(sd)) <= 1 && Math.abs(t(k.querySelector('.cmp-ch b')) - t(sd.querySelector('.cmp-ch b'))) <= 1
      }))
      record(id, 'Each app row is aligned across the Kafka and Solace cards (top, height and name)', aligned.length === 3 && aligned.every(Boolean), JSON.stringify(aligned))
      await page.locator('[data-app="Analytics"]').click(); await sleep(400)
      record(id, 'Adding an app adds a Kafka group and a Solace queue', (await $count('[data-kapp]')) === 4 && (await $count('[data-sapp]')) === 4 && (await $count('[data-sapp="Analytics"]')) === 1)
      await page.locator('[data-app="Analytics"]').click(); await sleep(400)
      record(id, 'The app chip removes it again', (await $count('[data-kapp]')) === 3 && (await $count('[data-sapp]')) === 3)
      await page.locator('[data-app="Notifications"]').click(); await sleep(300)
      await page.locator('[data-sapp="Notifications"] [data-remove-app="solace"]').click(); await sleep(400)
      record(id, 'An app card can be removed with its × (both sides)', (await $count('[data-kapp]')) === 3 && (await $count('[data-sapp="Notifications"]')) === 0 && (await $count('[data-kapp="Notifications"]')) === 0)
      const ks0 = await $text('[data-kafka-strategy]')
      record(id, 'Act 2 shows the Kafka topic and partition key', /topic/.test(ks0) && /hash\(/.test(ks0), ks0.replace(/\s+/g, ' ').slice(0, 80))
      const ss0 = await $text('[data-sapp="Fulfilment"] [data-solace-strategy]')
      record(id, 'Act 2 shows the Solace subscription and the key as a topic level', /subscribes/.test(ss0) && /topic level \d/.test(ss0), ss0.replace(/\s+/g, ' ').slice(0, 90))
      await page.locator('[data-key2]:not(.on)').first().click(); await sleep(400)
      const ks1 = await $text('[data-kafka-strategy]')
      record(id, 'Changing the partition key updates both sides', ks1 !== ks0 && (await $text('[data-sapp="Fulfilment"] [data-solace-strategy]')) !== ss0)
      const fkv = '[data-kapp="Fulfilment"]', sfv = '[data-sapp="Fulfilment"]'
      const sub0 = await $text(`${sfv} [data-ssub]`)
      await page.locator(`${fkv} [data-view="kafka"][data-i="1"]`).click(); await sleep(300)
      const sub1 = await $text(`${sfv} [data-ssub]`)
      record(id, 'Choosing a view narrows the Solace subscription', sub1 !== sub0 && sub1.length > 0, `${sub0} → ${sub1}`)
      const dsc = await poll(async () => ({ ok: (await $count(`${fkv} [data-kdiscard]`)) === 1 }), 8000)
      record(id, 'Kafka fetch-and-discard wastes consumer capacity on the view', dsc.ok)
      await page.locator(`${fkv} [data-route="topic"]`).click(); await sleep(300)
      record(id, 'Kafka own-topic routing adds a topic and a router app', (await $count(`${fkv} [data-extra-topic]`)) === 1)
      await page.locator(`${fkv} [data-view="kafka"][data-i="0"]`).click(); await sleep(300)
      const fk = '[data-kapp="Fulfilment"]'
      await page.locator('[data-mode="classic"]').click()
      for (let i = 0; i < 5; i++) await page.locator(`${fk} [data-kc="inc"]`).click()
      const idle = await poll(async () => ({ ok: (await $count(`${fk} [data-idle]`)) === 1 }), 3000)
      record(id, 'Kafka: consumers beyond the partition count sit idle', idle.ok)
      record(id, 'Kafka classic rebalance is stop-the-world', (await $text('[data-k-note]')).includes('STOP THE WORLD'))
      await page.locator('[data-mode="kip848"]').click()
      await page.locator(`${fk} [data-kc="dec"]`).click()
      record(id, 'Kafka KIP-848 pauses only the moved partitions', !(await $text('[data-k-note]')).includes('STOP THE WORLD'), (await $text('[data-k-note]')).slice(0, 70))
      await page.locator('[data-mode="share"]').click()
      await sleep(400)
      record(id, 'Kafka share group has no idle consumers', (await $count(`${fk} [data-idle]`)) === 0)
      record(id, 'Kafka cannot remove partitions (button disabled)', await page.locator('[data-kparts="dec"]').isDisabled())
      const kp = await $text('[data-kparts-n]')
      await page.locator('[data-kparts="inc"]').click()
      record(id, 'Kafka add partition warns that key ordering breaks', (await $text('.cmp-warn')).includes('hash to a different partition') && Number(await $text('[data-kparts-n]')) === Number(kp) + 1)
      const sf = '[data-sapp="Fulfilment"]'
      await page.locator(`${sf} [data-sc="inc"]`).click()
      record(id, 'Solace partitioned queue hands off only the affected partitions', (await $text('[data-s-note]')).includes('rest keep flowing'), (await $text('[data-s-note]')).slice(0, 80))
      await page.locator(`${sf} [data-sparts="inc"]`).click()
      const dr = await poll(async () => ({ ok: (await $count(`${sf} [data-draining]`)) === 1 }), 3000)
      record(id, 'Solace partition resize pauses ingress while the queue drains', dr.ok)
      const gone = await poll(async () => ({ ok: (await $count(`${sf} [data-draining]`)) === 0 }), 60000)
      record(id, 'Solace applies the new partition count after draining, still in order', gone.ok && /out-of-order 0/.test(await $text(`${sf} .cmp-num`)), (await $text(`${sf} .cmp-num`)).slice(0, 60))
      await page.locator('[data-sapp="Audit"] [data-qtype="partitioned"]').click(); await sleep(600)
      record(id, 'Solace queue type can change (exclusive → partitioned)', (await $count('[data-sapp="Audit"] .cmp-cell')) >= 4)
      await page.locator('[data-preset="reset"]').click()
    }
    if (id === 'wan') {
      await page.locator('.wan-hub .wan-core').last().click({ force: true })
      const down = await poll(async () => ({ ok: (await $count('.wan-hub.down')) === 1 && (await $text('.wan-hud')).includes('DEGRADED') }), 3000)
      await page.locator('.wan-hub .wan-core').last().click({ force: true })
      const up = await poll(async () => ({ ok: (await $count('.wan-hub.down')) === 0 && (await $text('.wan-hud')).includes('HEALTHY') }), 3000)
      record(id, 'clicking a hub fails it, clicking again restores it', down.ok && up.ok, `${down.ok ? 'down ok' : 'down failed'}, ${up.ok ? 'restored' : 'not restored'}`)
    }
    if (id === 'throughput' && I.throughput) {
      const t = I.throughput
      await page.locator('.tp-slider input').fill(String(t.slider))
      const r = await poll(async () => {
        const v = await $num('.tp-count span')
        return { ok: Math.abs(v - t.expectApprox) <= t.expectApprox * t.tolerance, v }
      }, 6000)
      record(id, `slider at ${t.slider}% sets the counter near ${t.expectApprox.toLocaleString()}`, r.ok, `counter → ${r.v}`)
    }
    if (id === 'kafka' && I.kafka) {
      await page.locator('[data-tab="bridge"]').click(); await sleep(700)
      const t = I.kafka
      if (t.keyChip) {
        const parts0 = await $count('.kb-part')
        await page.locator('[data-parts="inc"]').click()
        const grown = await poll(async () => { const c = await $count('.kb-part'); return { ok: c === parts0 + t.topics, v: c } }, 3000)
        await page.locator('[data-parts="dec"]').click()
        await page.locator(`[data-key="${t.keyChip}"]`).click()
        const keyed = await poll(async () => { const s = await $text('.kb-rec'); return { ok: s.includes(`key=${t.keyChip}`), v: s } }, 3000)
        await page.locator(`[data-key="${t.keyChip}"]`).click()
        const back = await poll(async () => ({ ok: (await $count('.kb-part')) === parts0 }), 3000)
        record(id, 'partition count and key are adjustable', grown.ok && keyed.ok && back.ok, `${parts0} → ${grown.v} partitions; key chip ${t.keyChip}: ${keyed.ok ? 'ok' : keyed.v}`)
      }
      await page.locator('.kb-filters .chip', { hasText: new RegExp(`^${t.chip}$`, 'i') }).click()
      const sub = await poll(async () => { const s = await $text('.kb-sub code'); return { ok: s === t.expectSub, v: s } }, 3000)
      record(id, `${t.chip} chip builds subscription ${t.expectSub}`, sub.ok, `got ${sub.v}`)
      const r = await poll(async () => {
        const venues = await page.locator('.kb-row:not(.kb-head) > span:nth-child(3)').allTextContents()
        const filtered = await $num('.kb-kpis div:nth-child(3) b')
        return { ok: venues.length >= 2 && venues.every((v) => t.allowedVenues.includes(v.trim())) && filtered > 20, v: `${venues.length} rows, ${filtered}% filtered${venues.every((v) => t.allowedVenues.includes(v.trim())) ? '' : `; unexpected: ${[...new Set(venues.map((v) => v.trim()).filter((v) => !t.allowedVenues.includes(v)))].join(',')} sub=${await $text('.kb-sub code')} rows=${(await page.locator('.kb-row:not(.kb-head)').allTextContents()).slice(0,3).join(' || ')}`}` }
      }, 20000)
      record(id, 'filtered blotter only shows the subscribed slice', r.ok, r.v)
      await page.locator('.kb-filters .chip', { hasText: /^ALL$/i }).first().click()
    }
    if (id === 'global') {
      const before = await $text('.gd-sub')
      await page.locator('.gd-sub').first().click()
      const r = await poll(async () => { const a = await $text('.gd-sub'); return { ok: a !== before && a !== '', v: a } }, 3000)
      record(id, "tapping a desk's subscription cycles it", r.ok, `${before} → ${r.v}`)
    }
    if (id === 'blotter' && I.blotter) {
      const t = I.blotter
      await page.locator('.desk-chips .chip', { hasText: new RegExp(`^${t.chip}$`, 'i') }).click()
      const sub = await poll(async () => { const s = await $text('.ob .bl-h em'); return { ok: s === t.expectSub, v: s } }, 3000)
      record(id, `${t.chip} chip changes the subscription to ${t.expectSub}`, sub.ok, `got ${sub.v}`)
      const r = await poll(async () => {
        const cells = await page.locator(`.ob-row:not(.ob-head) > span:nth-child(${t.deskColumn})`).allTextContents()
        return { ok: cells.length >= 1 && cells.every((c) => c.trim().toLowerCase() === t.chip.toLowerCase()), v: `${cells.length} rows` }
      }, 30000)
      record(id, `order blotter only shows ${t.chip} orders`, r.ok, r.v)
    }
  }

  await browser.close()
  const hard = problems.filter((p, i) => problems.indexOf(p) === i)
  console.log('\nbrowser errors')
  if (hard.length) hard.slice(0, 15).forEach((p) => console.log(`  ✗ ${p}`))
  record('page', 'no console errors, uncaught exceptions or failed requests', hard.length === 0, hard.length ? `${hard.length} problem(s)` : '')

  const failed = results.filter((r) => !r.ok && !r.soft)
  const warned = results.filter((r) => !r.ok && r.soft)
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ scenario: ex.scenario, url: baseUrl, when: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed: failed.length, warnings: warned.length, results, problems: hard }, null, 2))
  console.log(`\n${results.length - failed.length - warned.length} passed, ${failed.length} failed, ${warned.length} warning(s)   screenshots + report.json in ${path.relative(process.cwd(), outDir) || '.'}/`)
  return failed.length ? 1 : 0
}

let code = 1
try { code = await main() } catch (e) { console.error(e); code = 1 } finally { server?.kill() }
process.exit(code)
