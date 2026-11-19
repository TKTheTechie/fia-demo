import type { Scenario } from '../types.ts'

// The FIA Expo booth demo, expressed as data. Extracted verbatim from the original hardcoded
// values (market.ts, orders.ts, hubs.ts, Architecture.tsx, GlobalBlotters.tsx, TopicRouting.tsx,
// Blotter.tsx, content.ts and each section's heading). Nothing reads this yet; sections are
// still wired to their original constants until the refactor reaches them.

const inst = (id: string, origin: string, group: string, start: number, decimals: number, volatility: number) => ({
  id,
  group,
  origin,
  value: { start, decimals, volatility },
  // quoteLot: size multiplier on quotes; orderLot: order size increment.
  params: { quoteLot: group === 'equities' ? 100 : 1, orderLot: group === 'equities' ? 100 : group === 'fx' ? 1_000_000 : 1 },
})

const DESKS = ['DELTA1', 'MACRO', 'ALGO', 'VOL', 'FXSPOT']

export const capitalMarkets: Scenario = {
  id: 'capital-markets',
  title: 'Capital markets',
  vertical: 'Financial services',
  topicRoots: ['md', 'trade'],

  hero: {
    eyebrow: 'FIA Expo · Chicago',
    title: ['The event mesh', 'that moves markets.'],
    lede: 'Solace connects every feed handler, OMS, EMS, risk engine and trader UI — across colos, data centers and clouds — with one intelligent, topic-routed event mesh.',
    // Confirm with marketing that each name may be shown publicly. Set `logo` to a file in /public to use an official logo.
    clients: {
      label: 'Trusted by leading banks & exchanges',
      items: [
        { name: 'J.P. Morgan', serif: true },
        { name: 'Citi' },
        { name: 'Wells Fargo', serif: true },
        { name: 'TMX Group' },
        { name: 'Korea Exchange', short: 'KRX' },
        { name: 'National Stock Exchange of India', short: 'NSE' },
        { name: 'BSE' },
        { name: 'RBC', serif: true },
        { name: 'CIBC' },
      ],
    },
  },

  sections: ['flow', 'topics', 'latency', 'wan', 'throughput', 'hybrid', 'kafka', 'global', 'blotter'],
  copy: {
    flow: {
      eyebrow: 'End-to-end',
      nav: 'End-to-end',
      title: 'One mesh. [[Every hop]] of the trade lifecycle.',
      lede: 'From exchange feed to trader screen to clearing house — every component publishes and subscribes to topics on the Solace event mesh. No point-to-point spaghetti. Watch live order flow and market data move through the stack.',
    },
    topics: {
      eyebrow: 'Topic routing',
      nav: 'Topic routing',
      title: 'Subscribe to [[exactly]] what you need.',
      lede: 'Solace topics are hierarchical and filtered **in the broker**, not the client. Wildcards like `*` and `>` let each app pull a precise slice of millions of instruments — so desks stop drowning in data they throw away.',
    },
    latency: {
      eyebrow: 'Low latency',
      nav: 'Latency',
      title: 'Microseconds, [[deterministically]].',
      lede: 'When the alpha decays in microseconds, jitter is the enemy. Solace delivers low, flat, predictable latency — the tail matters as much as the median.',
    },
    wan: {
      eyebrow: 'WAN routing',
      nav: 'WAN',
      title: 'Chicago to Tokyo, [[one namespace]].',
      lede: 'Brokers in every colo, data center and cloud region link into a single event mesh. Subscriptions propagate automatically, so an app in Singapore subscribes to CME data exactly as it would in Aurora — and the mesh only sends across the WAN what someone actually asked for. Click a hub to simulate an outage.',
    },
    throughput: {
      eyebrow: 'Throughput',
      nav: 'Throughput',
      title: '[[Millions of messages per second]], without breaking a sweat.',
      lede: 'Open, close, a Fed announcement, an index rebalance — market data bursts are where messaging falls over. Solace absorbs the burst, protects slow consumers, and keeps the fast path fast. Drag the slider to push the load.',
    },
    hybrid: {
      eyebrow: 'Multi-form factor · Hybrid cloud',
      nav: 'Hybrid cloud',
      title: 'Same broker. [[Anywhere]] you run.',
      lede: 'Hardware in the colo, software in your data center, managed services in every major cloud — all speaking the same protocols, the same topics, managed as one mesh. Migrate workloads to the cloud at your own pace without rewriting a line of messaging code.',
    },
    kafka: {
      eyebrow: 'Kafka vs Solace',
      nav: 'Kafka',
      title: 'Same market data. [[Very different]] work for every consumer.',
      lede: "Kafka's flat topics make a desk, a risk engine and a surveillance feed fetch whole topics and throw most of it away — or build re-publishing pipelines — and scaling a consumer means re-partitioning. With Solace each app subscribes to exactly the events it needs and picks the queue type that fits how it scales. Add consumers, partitions and queue types below and watch what changes.",
      extra: 'Market data lands on flat Kafka topics. The Kafka bridge is integrated inside the Solace broker — no separate connector to run. It builds a hierarchical Solace topic from just the Kafka topic name and record headers, passing the payload through untouched — so each trader UI subscribes to just the asset class, symbol or event type it needs, filtered in the broker and pushed straight to the glass.',
    },
    global: {
      eyebrow: 'Global distribution',
      nav: 'Global',
      title: 'Every desk, every region, [[its own stream]].',
      lede: "Regional Kafka clusters feed the mesh through the Kafka bridge. Blotters in New York, London, Frankfurt, Singapore and Tokyo each subscribe to exactly what they trade — and the mesh only sends an event across a WAN link when someone on the far side asked for it. Tap a desk's subscription to change it.",
    },
    blotter: {
      eyebrow: 'Live blotter',
      nav: 'Blotter',
      title: 'Every screen, [[streaming]] in real time.',
      lede: 'Trader UIs subscribe straight to the mesh over WebSocket — no polling, no middle tier. Filter by desk and the subscription changes on the broker; only the events you need hit the glass.',
    },
  },

  model: {
    labels: { id: 'Symbol', group: 'Asset class', origin: 'Venue' },
    entities: [
      inst('ES', 'CME', 'futures', 6012.25, 2, 0.00018),
      inst('NQ', 'CME', 'futures', 21344.5, 2, 0.00024),
      inst('ZN', 'CBOT', 'rates', 110.515, 3, 0.00006),
      inst('CL', 'NYMEX', 'futures', 71.42, 2, 0.00035),
      inst('GC', 'COMEX', 'futures', 2741.3, 1, 0.0002),
      inst('AAPL', 'NASDAQ', 'equities', 228.52, 2, 0.0003),
      inst('NVDA', 'NASDAQ', 'equities', 141.87, 2, 0.0005),
      inst('JPM', 'NYSE', 'equities', 224.19, 2, 0.00025),
      inst('EURUSD', 'EBS', 'fx', 1.08542, 5, 0.00008),
      inst('USDJPY', 'EBS', 'fx', 152.314, 3, 0.0001),
      inst('GBPUSD', 'LSEG', 'fx', 1.29873, 5, 0.00009),
      inst('BTC', 'CME', 'crypto', 69420, 0, 0.0007),
    ],
  },

  watch: { title: 'MARKET WATCH', columns: ['BID', 'ASK'] },

  kafka: {
    topics: [
      { name: 'mktdata.quote', partitions: 7, keyBy: 'id', headers: { asset: 'group', venue: 'origin', sym: 'id' }, weight: 0.62, render: 'bidask' },
      { name: 'mktdata.trade', partitions: 7, keyBy: 'id', headers: { asset: 'group', venue: 'origin', sym: 'id' }, weight: 0.38, render: 'value' },
    ],
    // md/{asset}/{venue}/{sym}/{quote|trade}, built from the Kafka topic name + headers only.
    bridge: { segments: [{ literal: 'md' }, { header: 'asset' }, { header: 'venue' }, { header: 'sym' }, { topicSuffix: 'mktdata.' }] },
    ui: {
      chipHeader: 'asset',
      chipLabel: 'ASSET',
      chips: [
        { id: 'equities', label: 'Equities' },
        { id: 'futures', label: 'Futures' },
        { id: 'fx', label: 'FX' },
        { id: 'rates', label: 'Rates' },
        { id: 'crypto', label: 'Crypto' },
      ],
      typeLabel: 'TYPE',
      idHeader: 'sym',
      idLabel: 'SYM',
      idPlaceholder: '* or N*',
      originLabel: 'VENUE',
      valueLabel: 'PRICE',
      extra: { label: 'SIZE' },
    },
  },

  lifecycle: {
    noun: 'order',
    pattern: 'trade/{stage}/{desk}/{origin}/{id}',
    facets: { desk: DESKS },
    attributes: { side: ['BUY', 'SELL'], strategy: ['VWAP', 'TWAP', 'POV', 'SNIPER', 'ICEBERG', 'DMA'] },
    stages: [
      { id: 'oms/new', status: 'NEW', delayMs: [0, 0], next: 'risk/check' },
      { id: 'risk/check', status: 'NEW', delayMs: [160, 160], branches: [{ to: 'risk/reject', p: 0.04 }], next: 'ems/route' },
      { id: 'risk/reject', status: 'REJECTED', delayMs: [0, 0] },
      { id: 'ems/route', status: 'ACK', delayMs: [180, 180], next: 'exec/fill' },
      { id: 'exec/fill', status: 'FILLED', statusWhileRepeating: 'PARTIAL', delayMs: [250, 1200], repeat: [1, 3], next: 'post/clear' },
      { id: 'post/clear', status: 'FILLED', delayMs: [400, 400] },
    ],
    statuses: [
      { id: 'NEW', tone: 'new' },
      { id: 'ACK', tone: 'ack' },
      { id: 'PARTIAL', tone: 'partial' },
      { id: 'FILLED', tone: 'done' },
      { id: 'REJECTED', tone: 'bad' },
      { id: 'CANCELLED', tone: 'bad' },
    ],
  },

  architecture: {
    nodes: [
      { id: 'venue', label: 'Exchanges', sub: 'CME · NASDAQ · EBS', x: 100, row: 'top', color: 'var(--amber)', icon: '⬢' },
      { id: 'fh', label: 'Feed Handlers', sub: 'normalize · conflate', x: 300, row: 'top', color: 'var(--cyan)', icon: '≋' },
      { id: 'price', label: 'Pricing Engine', sub: 'curves · greeks', x: 500, row: 'top', color: 'var(--violet)', icon: 'ƒ' },
      { id: 'algo', label: 'Algo / SOR', sub: 'VWAP · POV · DMA', x: 700, row: 'top', color: 'var(--violet)', icon: '⟁' },
      { id: 'risk', label: 'Pre-Trade Risk', sub: 'limits · kill-switch', x: 900, row: 'top', color: 'var(--sell)', icon: '⛨' },
      { id: 'ui', label: 'Trader UIs', sub: 'web · desktop · mobile', x: 1100, row: 'top', color: 'var(--brand)', icon: '▣' },
      { id: 'oms', label: 'OMS', sub: 'orders · allocations', x: 100, row: 'bot', color: 'var(--brand)', icon: '☰' },
      { id: 'ems', label: 'EMS', sub: 'execution mgmt', x: 300, row: 'bot', color: 'var(--cyan)', icon: '⇄' },
      { id: 'fix', label: 'FIX Gateway', sub: 'venue connectivity', x: 500, row: 'bot', color: 'var(--amber)', icon: '⌁' },
      { id: 'post', label: 'Post-Trade', sub: 'clearing · settlement', x: 700, row: 'bot', color: 'var(--cyan)', icon: '✓' },
      { id: 'tca', label: 'Analytics / TCA', sub: 'data lake · AI', x: 900, row: 'bot', color: 'var(--violet)', icon: '◔' },
      { id: 'comp', label: 'Surveillance', sub: 'compliance · audit', x: 1100, row: 'bot', color: 'var(--muted)', icon: '◉' },
    ],
    routes: [
      { sub: 'md/>', hops: [['fh', 'price'], ['fh', 'algo'], ['fh', 'ui'], ['fh', 'risk'], ['fh', 'tca']], color: 'var(--cyan)', sample: 0.35, lead: { from: 'venue', to: 'fh', color: 'var(--amber)' } },
      { sub: 'trade/oms/new/>', hops: [['oms', 'risk']], color: 'var(--brand)', sample: 1 },
      { sub: 'trade/risk/check/>', hops: [['risk', 'ems']], color: 'var(--amber)', sample: 1 },
      { sub: 'trade/risk/reject/>', hops: [['risk', 'oms'], ['risk', 'comp']], color: 'var(--sell)', sample: 1 },
      { sub: 'trade/ems/route/>', hops: [['ems', 'algo'], ['algo', 'fix']], color: 'var(--violet)', sample: 1 },
      { sub: 'trade/exec/fill/>', hops: [['fix', 'oms'], ['fix', 'ui'], ['fix', 'risk']], color: 'var(--buy)', sample: 1 },
      { sub: 'trade/post/clear/>', hops: [['oms', 'post'], ['oms', 'tca'], ['oms', 'comp']], color: 'var(--cyan)', sample: 1 },
    ],
  },

  sites: {
    hubs: [
      { id: 'CHI', name: 'Chicago', dc: 'Aurora · CME colo', lon: -88.3, lat: 41.76, kind: 'colo', label: 'tl' },
      { id: 'NY4', name: 'New Jersey', dc: 'Secaucus · NY4', lon: -74.06, lat: 40.79, kind: 'colo', label: 'r' },
      { id: 'USE', name: 'N. Virginia', dc: 'AWS us-east-1', lon: -77.5, lat: 39.0, kind: 'cloud', label: 'bl' },
      { id: 'LD4', name: 'London', dc: 'Slough · LD4', lon: -0.6, lat: 51.5, kind: 'colo', label: 'l' },
      { id: 'FR2', name: 'Frankfurt', dc: 'Eurex · FR2', lon: 8.68, lat: 50.11, kind: 'colo' },
      { id: 'SG1', name: 'Singapore', dc: 'SGX · SG1', lon: 103.85, lat: 1.29, kind: 'colo' },
      { id: 'TY3', name: 'Tokyo', dc: 'JPX · TY3', lon: 139.69, lat: 35.68, kind: 'colo' },
      { id: 'HK1', name: 'Hong Kong', dc: 'HKEX', lon: 114.17, lat: 22.32, kind: 'dc', label: 'br' },
      { id: 'SYD', name: 'Sydney', dc: 'Azure australiaeast', lon: 151.2, lat: -33.86, kind: 'cloud' },
      { id: 'SAO', name: 'São Paulo', dc: 'B3', lon: -46.63, lat: -23.55, kind: 'dc' },
      { id: 'MUM', name: 'Mumbai', dc: 'GCP asia-south1', lon: 72.88, lat: 19.07, kind: 'cloud', label: 'l' },
    ],
    links: [
      ['CHI', 'NY4'], ['NY4', 'USE'], ['NY4', 'LD4'], ['CHI', 'LD4'], ['LD4', 'FR2'], ['LD4', 'SG1'], ['FR2', 'MUM'],
      ['MUM', 'SG1'], ['SG1', 'HK1'], ['HK1', 'TY3'], ['HK1', 'LD4'], ['SG1', 'SYD'], ['NY4', 'SAO'], ['TY3', 'SYD'], ['USE', 'SAO'],
    ],
    ingest: { CME: 'CHI', CBOT: 'CHI', NYMEX: 'NY4', COMEX: 'NY4', NASDAQ: 'NY4', NYSE: 'NY4', EBS: 'LD4', LSEG: 'LD4' },
    kafkaBadge: { CHI: [-34, -8], NY4: [-8, 12], LD4: [10, -28] },
  },

  personas: [
    { id: 'nyc', site: 'NY4', city: 'New York', role: 'Equities', subs: ['md/equities/>', 'md/equities/NASDAQ/>', 'md/*/*/NVDA/>'] },
    { id: 'chi', site: 'CHI', city: 'Chicago', role: 'Futures', subs: ['md/futures/CME/>', 'md/futures/>', 'md/*/CME/*/trade'] },
    { id: 'ldn', site: 'LD4', city: 'London', role: 'FX spot', subs: ['md/fx/>', 'md/fx/*/GBPUSD/>', 'md/fx/*/*/trade'] },
    { id: 'fra', site: 'FR2', city: 'Frankfurt', role: 'Rates', subs: ['md/rates/>', 'md/rates/*/ZN/quote', 'md/futures/COMEX/GC/>'] },
    { id: 'sgp', site: 'SG1', city: 'Singapore', role: 'Macro', subs: ['md/*/*/*/trade', 'md/futures/*/CL/>', 'md/crypto/>'] },
    { id: 'tyo', site: 'TY3', city: 'Tokyo', role: 'JPY & index', subs: ['md/fx/*/USDJPY/>', 'md/futures/CME/NQ/>', 'md/*/*/USD*/>'] },
  ],

  presets: [
    { sub: 'md/futures/CME/>', desc: 'All CME futures quotes' },
    { sub: 'md/*/NASDAQ/*/quote', desc: 'Every NASDAQ quote' },
    { sub: 'md/fx/>', desc: 'All FX, any venue' },
    { sub: 'trade/exec/fill/ALGO/>', desc: 'Fills for the algo desk' },
    { sub: 'trade/*/*/*/*/NVDA', desc: 'NVDA lifecycle, every stage' },
    { sub: 'trade/risk/reject/>', desc: 'Risk rejects (surveillance)' },
    { sub: 'md/*/*/E*/>', desc: 'Prefix wildcard: symbols E*' },
  ],

  hybrid: { onPrem: ['Matching-engine colo', 'Primary DC', 'DR site'], cloud: ['AWS', 'Microsoft Azure', 'Google Cloud'] },
  consumerNoun: 'desk',

  blotter: {
    title: 'ORDER BLOTTER',
    allLabel: 'ALL DESKS',
    facet: 'desk',
    kpis: { total: 'orders', done: 'filled', bad: 'risk rejects', value: { label: 'notional', prefix: '$' } },
    columns: [
      { key: 'id', label: 'ORDER', format: 'id' },
      { key: 'side', label: 'SIDE', format: 'side' },
      { key: 'entity', label: 'SYM', format: 'text' },
      { key: 'desk', label: 'DESK', format: 'text', hideSmall: true },
      { key: 'strategy', label: 'ALGO', format: 'text', hideSmall: true },
      { key: 'qty', label: 'QTY', format: 'int' },
      { key: 'filled', label: 'FILLED', format: 'progress' },
      { key: 'avgValue', label: 'AVG PX', format: 'price', hideSmall: true },
      { key: 'status', label: 'STATUS', format: 'status' },
    ],
  },
}
