import type { Entity, Scenario } from '../types.ts'

// Retail & supply chain: stock levels from stores flow through Kafka into the mesh; customer
// orders move through order management, warehouse, and transport. Every name here (stores,
// SKUs, sites) is invented for the demo.
//
// Topics:
//   retail/stock/{region}/{store}/{category}/{sku}/{level|movement}      (Kafka bridge)
//   retail/order/{system}/{action}/{channel}/{store}/{sku}               (order lifecycle)

const sku = (id: string, store: string, region: string, category: string, start: number, volatility: number): Entity => ({
  id,
  group: category,
  origin: store,
  attrs: { region },
  // units on hand: sales drain it, a delivery refills it below the reorder point (start = target stock)
  value: { start, decimals: 0, volatility, sawtooth: { drain: 0.012, reorder: 0.12, refill: 1 } },
  params: { orderLot: 1 },
})

const CHANNELS = ['web', 'app', 'store', 'marketplace']

export const retailSupplyChain: Scenario = {
  id: 'retail-supply-chain',
  title: 'Retail & supply chain',
  vertical: 'Retail',
  topicRoots: ['retail'],

  hero: {
    eyebrow: 'Retail & supply chain',
    title: ['Stock and orders,', 'in real time.'],
    lede: 'Solace connects point of sale, inventory, order management, warehouses and carriers — across stores, distribution centers and clouds — so every stock change and every order status is an event, delivered to whoever needs it, the moment it happens.',
    // No client strip: add `clients` here once the retail customer names to show are cleared.
  },

  // No latency section: microsecond jitter is not this audience's story.
  sections: ['flow', 'topics', 'wan', 'throughput', 'hybrid', 'kafka', 'global', 'blotter'],
  copy: {
    flow: {
      eyebrow: 'End-to-end',
      nav: 'End-to-end',
      title: 'One mesh. [[Every hop]] from shelf to doorstep.',
      lede: 'From supplier to shelf to doorstep — point of sale, inventory, order management, warehouses and carriers all publish and subscribe to topics on the Solace event mesh. No point-to-point integrations to untangle. Watch stock changes and orders move through the stack.',
    },
    topics: {
      eyebrow: 'Topic routing',
      nav: 'Topic routing',
      title: 'Subscribe to [[exactly]] what you need.',
      lede: 'Solace topics are hierarchical and filtered **in the broker**, not the client. Wildcards like `*` and `>` let a store app see only its own stock, a category manager follow one product family across every region, and a service screen track a single order — without anyone filtering a firehose.',
    },
    wan: {
      eyebrow: 'WAN routing',
      nav: 'WAN',
      title: 'Store floor to cloud, [[one namespace]].',
      lede: 'Brokers deployed in the stores of every retail division connect up to regionally deployed cloud brokers, and the regions link into a single event mesh. Subscriptions propagate automatically, so a planner in Dublin subscribes to stock levels exactly as a store manager in Boston would — and the mesh only sends across the WAN what someone actually asked for. Click a broker to simulate an outage.',
    },
    throughput: {
      eyebrow: 'Throughput',
      nav: 'Throughput',
      title: 'Peak season, [[without breaking a sweat]].',
      lede: 'Flash sales, holiday peaks, one viral product — stock and order events spike by orders of magnitude. Solace absorbs the burst, protects slow consumers, and keeps the fast path fast. Drag the slider to push the load.',
    },
    hybrid: {
      eyebrow: 'Multi-form factor · Hybrid cloud',
      nav: 'Hybrid cloud',
      title: 'Same broker. [[Anywhere]] you run.',
      lede: 'Software in the store back room and the distribution center, managed services in every major cloud — all speaking the same protocols, the same topics, managed as one mesh. Move workloads to the cloud at your own pace without rewriting a line of messaging code.',
    },
    kafka: {
      eyebrow: 'Kafka vs Solace',
      nav: 'Kafka',
      title: 'Same stock stream. [[Very different]] work for every consumer.',
      lede: "Kafka's flat topics make a store app, a category planner and a fraud service fetch whole topics and throw most of it away — or build re-publishing pipelines — and scaling a consumer means re-partitioning. With Solace each app subscribes to exactly the events it needs and picks the queue type that fits how it scales. Add consumers, partitions and queue types below and watch what changes.",
      extra: 'Stock and inventory data lands on flat Kafka topics. The Kafka bridge is integrated inside the Solace broker — no separate connector to run. It builds a hierarchical Solace topic from just the Kafka topic name and record headers, passing the payload through untouched — so each store app, planner and storefront subscribes to just the region, store or category it needs, filtered in the broker and pushed straight to the glass.',
    },
    global: {
      eyebrow: 'Global distribution',
      nav: 'Global',
      title: 'Every store, every region, [[its own stream]].',
      lede: "Regional Kafka clusters feed the mesh through the Kafka bridge. Teams in the Northeast, Virginia, the Midwest, Dublin, Central Europe and Singapore each subscribe to exactly what they run — and the mesh only sends an event across a WAN link when someone on the far side asked for it. Tap a team's subscription to change it.",
    },
    blotter: {
      eyebrow: 'Live order tracker',
      nav: 'Tracker',
      title: 'Every screen, [[streaming]] in real time.',
      lede: 'Store, warehouse and customer-service screens subscribe straight to the mesh over WebSocket — no polling, no middle tier. Filter by sales channel and the subscription changes on the broker; only the events you need hit the glass.',
    },
  },

  model: {
    labels: { id: 'SKU', group: 'Category', origin: 'Store' },
    entities: [
      sku('GRO-1042', 'NYC-01', 'NA-EAST', 'grocery', 1200, 0.015),
      sku('ELE-2210', 'NYC-01', 'NA-EAST', 'electronics', 85, 0.03),
      sku('APP-3305', 'BOS-02', 'NA-EAST', 'apparel', 260, 0.02),
      sku('HOM-4120', 'BOS-02', 'NA-EAST', 'home', 140, 0.02),
      sku('GRO-1077', 'CHI-03', 'NA-CENTRAL', 'grocery', 1800, 0.012),
      sku('ELE-2275', 'CHI-03', 'NA-CENTRAL', 'electronics', 120, 0.03),
      sku('BEA-5051', 'DAL-04', 'NA-CENTRAL', 'beauty', 330, 0.018),
      sku('APP-3390', 'DAL-04', 'NA-CENTRAL', 'apparel', 410, 0.02),
      sku('ELE-2301', 'LAX-05', 'NA-WEST', 'electronics', 95, 0.035),
      sku('HOM-4188', 'LAX-05', 'NA-WEST', 'home', 180, 0.02),
      sku('GRO-1103', 'LON-06', 'EMEA', 'grocery', 950, 0.015),
      sku('APP-3412', 'LON-06', 'EMEA', 'apparel', 300, 0.02),
      sku('BEA-5088', 'PAR-07', 'EMEA', 'beauty', 270, 0.018),
      sku('HOM-4233', 'PAR-07', 'EMEA', 'home', 150, 0.02),
      sku('ELE-2340', 'BER-08', 'EMEA', 'electronics', 110, 0.03),
      sku('GRO-1121', 'BER-08', 'EMEA', 'grocery', 1100, 0.014),
      sku('APP-3450', 'SIN-09', 'APAC', 'apparel', 220, 0.022),
      sku('BEA-5102', 'SIN-09', 'APAC', 'beauty', 310, 0.02),
    ],
  },

  tape: false, // a ticker tape is a finance idiom
  watch: {
    title: 'INVENTORY WATCH',
    columns: ['ON HAND'],
    level: { capacity: 1.15, low: 0.35, critical: 0.2, labels: { ok: 'IN STOCK', low: 'LOW', critical: 'REORDER', restock: 'RESTOCKED' } },
  },

  kafka: {
    topics: [
      { name: 'stock.level', partitions: 8, keyBy: 'id', headers: { region: 'attrs.region', store: 'origin', category: 'group', sku: 'id' }, weight: 0.75, render: 'value' },
      { name: 'stock.movement', partitions: 4, keyBy: 'id', headers: { region: 'attrs.region', store: 'origin', category: 'group', sku: 'id' }, weight: 0.25, render: 'delta' },
    ],
    // retail/stock/{region}/{store}/{category}/{sku}/{level|movement}
    bridge: {
      segments: [{ literal: 'retail' }, { literal: 'stock' }, { header: 'region' }, { header: 'store' }, { header: 'category' }, { header: 'sku' }, { topicSuffix: 'stock.' }],
    },
    ui: {
      chipHeader: 'category',
      chipLabel: 'CATEGORY',
      chips: [
        { id: 'grocery', label: 'Grocery' },
        { id: 'electronics', label: 'Electronics' },
        { id: 'apparel', label: 'Apparel' },
        { id: 'home', label: 'Home' },
        { id: 'beauty', label: 'Beauty' },
      ],
      typeLabel: 'TYPE',
      idHeader: 'sku',
      idLabel: 'SKU',
      idPlaceholder: '* or GRO*',
      originLabel: 'STORE',
      valueLabel: 'UNITS',
      extra: { label: 'REGION', header: 'region' },
    },
  },

  lifecycle: {
    noun: 'order',
    idPrefix: 'SO',
    qty: [1, 6],
    pattern: 'retail/order/{stage}/{channel}/{origin}/{id}',
    facets: { channel: CHANNELS },
    attributes: { service: ['Standard', 'Express', 'Same-day', 'Click & collect'] },
    stages: [
      { id: 'oms/placed', status: 'PLACED', delayMs: [0, 0], next: 'inv/reserve' },
      { id: 'inv/reserve', status: 'PLACED', delayMs: [150, 400], branches: [{ to: 'inv/stockout', p: 0.05 }], next: 'wms/pick' },
      { id: 'inv/stockout', status: 'STOCKOUT', delayMs: [0, 0] },
      { id: 'wms/pick', status: 'PICKING', progress: 0.25, delayMs: [300, 900], branches: [{ to: 'oms/cancel', p: 0.03 }], next: 'wms/pack' },
      { id: 'oms/cancel', status: 'CANCELLED', delayMs: [0, 0] },
      { id: 'wms/pack', status: 'PACKED', progress: 0.5, delayMs: [400, 1000], next: 'tms/dispatch' },
      { id: 'tms/dispatch', status: 'SHIPPED', progress: 0.75, delayMs: [300, 800], next: 'tms/scan' },
      { id: 'tms/scan', status: 'SHIPPED', delayMs: [400, 1200], repeat: [1, 3], next: 'tms/deliver' },
      { id: 'tms/deliver', status: 'DELIVERED', progress: 1, delayMs: [500, 1200] },
    ],
    statuses: [
      { id: 'PLACED', tone: 'new' },
      { id: 'PICKING', tone: 'ack' },
      { id: 'PACKED', tone: 'ack' },
      { id: 'SHIPPED', tone: 'partial' },
      { id: 'DELIVERED', tone: 'done' },
      { id: 'STOCKOUT', tone: 'bad' },
      { id: 'CANCELLED', tone: 'bad' },
    ],
  },

  architecture: {
    nodes: [
      { id: 'web', label: 'Storefronts', sub: 'web · app · marketplace', x: 100, row: 'top', color: 'var(--brand)', icon: '▣' },
      { id: 'price', label: 'Pricing & Promo', sub: 'offers · markdowns', x: 300, row: 'top', color: 'var(--violet)', icon: '％' },
      { id: 'oms', label: 'Order Mgmt', sub: 'orders · allocation', x: 500, row: 'top', color: 'var(--brand)', icon: '☰' },
      { id: 'inv', label: 'Inventory', sub: 'available-to-promise', x: 700, row: 'top', color: 'var(--cyan)', icon: '▤' },
      { id: 'pay', label: 'Payments & Fraud', sub: 'auth · risk scoring', x: 900, row: 'top', color: 'var(--sell)', icon: '⛨' },
      { id: 'cx', label: 'Customer Comms', sub: 'email · push · SMS', x: 1100, row: 'top', color: 'var(--amber)', icon: '✉' },
      { id: 'pos', label: 'Store POS', sub: 'sales · returns', x: 100, row: 'bot', color: 'var(--amber)', icon: '◍' },
      { id: 'wms', label: 'Warehouse Mgmt', sub: 'pick · pack · receive', x: 300, row: 'bot', color: 'var(--cyan)', icon: '▦' },
      { id: 'tms', label: 'Transport Mgmt', sub: 'carriers · tracking', x: 500, row: 'bot', color: 'var(--cyan)', icon: '⇄' },
      { id: 'sup', label: 'Suppliers / EDI', sub: 'POs · ASNs', x: 700, row: 'bot', color: 'var(--amber)', icon: '⟲' },
      { id: 'plan', label: 'Demand Planning', sub: 'forecast · replenish', x: 900, row: 'bot', color: 'var(--violet)', icon: '◔' },
      { id: 'ana', label: 'Analytics / AI', sub: 'data lake · insights', x: 1100, row: 'bot', color: 'var(--violet)', icon: '◉' },
    ],
    routes: [
      { sub: 'retail/stock/>', hops: [['pos', 'inv'], ['inv', 'web'], ['inv', 'plan'], ['inv', 'ana']], color: 'var(--cyan)', sample: 0.35 },
      { sub: 'retail/order/oms/placed/>', hops: [['web', 'oms'], ['oms', 'pay']], color: 'var(--brand)', sample: 1 },
      { sub: 'retail/order/inv/reserve/>', hops: [['oms', 'inv']], color: 'var(--amber)', sample: 1 },
      { sub: 'retail/order/inv/stockout/>', hops: [['inv', 'oms'], ['inv', 'plan']], color: 'var(--sell)', sample: 1 },
      { sub: 'retail/order/wms/pick/>', hops: [['oms', 'wms']], color: 'var(--violet)', sample: 1 },
      { sub: 'retail/order/wms/pack/>', hops: [['wms', 'tms']], color: 'var(--cyan)', sample: 1 },
      { sub: 'retail/order/tms/scan/>', hops: [['tms', 'web'], ['tms', 'cx']], color: 'var(--amber)', sample: 1 },
      { sub: 'retail/order/tms/deliver/>', hops: [['tms', 'oms'], ['tms', 'cx'], ['tms', 'ana']], color: 'var(--buy)', sample: 1 },
    ],
  },

  sites: {
    // Edge brokers run in the stores of each retail division and connect up to regionally deployed cloud brokers.
    kindLabels: { edge: 'Store division', cloud: 'Regional cloud', dc: 'Data center' },
    hubs: [
      { id: 'NE', name: 'Northeast', dc: '118 stores', lon: -71.06, lat: 42.36, kind: 'edge', label: 'r' },
      { id: 'MID', name: 'Midwest', dc: '164 stores', lon: -87.9, lat: 41.9, kind: 'edge', label: 'tl' },
      { id: 'TX', name: 'South', dc: '142 stores', lon: -96.8, lat: 32.8, kind: 'edge', label: 'bl' },
      { id: 'WST', name: 'West', dc: '96 stores', lon: -118.2, lat: 34.0, kind: 'edge', label: 'bl' },
      { id: 'UKI', name: 'UK & Ireland', dc: '210 stores', lon: -0.1, lat: 51.5, kind: 'edge', label: 'bl' },
      { id: 'CEE', name: 'Central Europe', dc: '88 stores', lon: 21.0, lat: 52.2, kind: 'edge', label: 'r' },
      { id: 'SEA', name: 'SE Asia', dc: '73 stores', lon: 100.5, lat: 13.7, kind: 'edge', label: 'l' },
      { id: 'USE', name: 'N. Virginia', dc: 'AWS us-east-1', lon: -77.5, lat: 39.0, kind: 'cloud', label: 'br' },
      { id: 'PDX', name: 'Portland', dc: 'AWS us-west-2', lon: -122.7, lat: 45.5, kind: 'cloud', label: 'l' },
      { id: 'DUB', name: 'Dublin', dc: 'Azure northeurope', lon: -6.26, lat: 53.35, kind: 'cloud', label: 'l' },
      { id: 'FRA', name: 'Frankfurt', dc: 'Azure germanywestcentral', lon: 8.68, lat: 50.11, kind: 'cloud', label: 'br' },
      { id: 'SIN', name: 'Singapore', dc: 'GCP asia-southeast1', lon: 103.85, lat: 1.29, kind: 'cloud' },
    ],
    links: [
      ['NE', 'USE'], ['MID', 'USE'], ['TX', 'USE'], ['WST', 'PDX'], ['UKI', 'DUB'], ['CEE', 'FRA'], ['SEA', 'SIN'],
      ['USE', 'PDX'], ['USE', 'DUB'], ['DUB', 'FRA'], ['FRA', 'SIN'],
    ],
    kafkaBadge: { USE: [-8, 14], PDX: [-8, -28], DUB: [-8, -28], FRA: [-30, 8], SIN: [-8, -28] },
    // store -> hub whose regional Kafka cluster ingests its stock events
    ingest: { 'NYC-01': 'USE', 'BOS-02': 'USE', 'CHI-03': 'USE', 'DAL-04': 'USE', 'LAX-05': 'PDX', 'LON-06': 'DUB', 'PAR-07': 'FRA', 'BER-08': 'FRA', 'SIN-09': 'SIN' },
  },

  personas: [
    { id: 'ne', site: 'NE', city: 'Northeast', role: 'Store ops · East', subs: ['retail/stock/NA-EAST/>', 'retail/stock/NA-EAST/NYC-01/>', 'retail/order/*/*/store/>'] },
    { id: 'hq', site: 'USE', city: 'N. Virginia', role: 'Merchandising HQ', subs: ['retail/stock/*/*/electronics/>', 'retail/stock/*/*/apparel/>', 'retail/stock/*/*/*/*/movement'] },
    { id: 'mid', site: 'MID', city: 'Midwest', role: 'Distribution center', subs: ['retail/order/wms/>', 'retail/order/*/*/*/CHI-03/>', 'retail/order/wms/pack/>'] },
    { id: 'dub', site: 'DUB', city: 'Dublin', role: 'EMEA planning', subs: ['retail/stock/EMEA/>', 'retail/stock/EMEA/*/grocery/>', 'retail/order/inv/stockout/>'] },
    { id: 'cee', site: 'CEE', city: 'Central Europe', role: 'Customer service', subs: ['retail/order/oms/>', 'retail/order/*/*/web/>', 'retail/order/tms/deliver/>'] },
    { id: 'sin', site: 'SIN', city: 'Singapore', role: 'Marketplace ops', subs: ['retail/stock/APAC/>', 'retail/order/*/*/marketplace/>', 'retail/stock/*/*/beauty/>'] },
  ],

  presets: [
    { sub: 'retail/stock/EMEA/>', desc: 'All EMEA stock' },
    { sub: 'retail/stock/*/*/electronics/>', desc: 'Electronics, every store' },
    { sub: 'retail/stock/*/NYC-01/>', desc: 'One store: NYC-01' },
    { sub: 'retail/stock/*/*/*/*/movement', desc: 'Stock movements only' },
    { sub: 'retail/order/inv/stockout/>', desc: 'Stock-outs (planning)' },
    { sub: 'retail/order/*/*/web/>', desc: 'Web orders, every stage' },
    { sub: 'retail/order/*/*/*/*/GRO-*', desc: 'Prefix wildcard: grocery SKUs' },
  ],

  hybrid: { onPrem: ['Store back-room edge', 'Distribution center', 'Regional data center'], cloud: ['AWS', 'Microsoft Azure', 'Google Cloud'] },
  consumerNoun: '',

  blotter: {
    title: 'ORDER TRACKER',
    allLabel: 'ALL CHANNELS',
    facet: 'channel',
    kpis: { total: 'orders', done: 'delivered', bad: 'exceptions' },
    columns: [
      { key: 'id', label: 'ORDER', format: 'id' },
      { key: 'channel', label: 'CHANNEL', format: 'text', weight: 1.1 },
      { key: 'entity', label: 'SKU', format: 'text' },
      { key: 'origin', label: 'STORE', format: 'text', hideSmall: true },
      { key: 'service', label: 'SERVICE', format: 'text', hideSmall: true, weight: 1.5 },
      { key: 'qty', label: 'QTY', format: 'int' },
      { key: 'filled', label: 'FULFILLED', format: 'progress' },
      { key: 'status', label: 'STATUS', format: 'status' },
    ],
  },
}
