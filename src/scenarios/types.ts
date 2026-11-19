// Scenario = the *domain* a demo is about (capital markets, retail, logistics...).
// A scenario is plain data so an SE can author one without touching React, and so it can be
// validated (src/scenarios/validate.ts) and, later, loaded at runtime or generated.
//
// Not covered here (by design, for now): brand / prospect skin, and the live-mode runtime.
// Generators are added when sections are wired to scenarios (see docs/DESIGN.md, phase 2-3).
//
// NOTE: this file and its siblings use explicit `.ts` import extensions and `import type`
// so they can also be executed directly by Node (scripts/check-scenarios.mjs).

/** Tiny inline markup so copy stays data (no JSX in scenario files):
 *  `[[text]]` = gradient accent, `**text**` = bold, `` `text` `` = code. */
export type Rich = string

export type SectionId = 'flow' | 'topics' | 'latency' | 'wan' | 'throughput' | 'hybrid' | 'kafka' | 'global' | 'blotter'

/** `eyebrow` is the label only; the number ("03 · ...") is added from the position in `sections`,
 *  so a scenario can drop a section without leaving a gap. */
/** `nav` is the short label in the top navigation (defaults to `eyebrow`). */
export type SectionCopy = {
  eyebrow: string
  title: Rich
  lede?: Rich
  nav?: string
  /** Optional second paragraph a section may show inside itself (the Kafka section's Bridge tab intro). */
  extra?: Rich
}

/** Built-in fields of an Entity. */
export type EntityField = 'id' | 'group' | 'origin'
/** A built-in field, or an extra dimension from `Entity.attrs` written `attrs.<name>` (e.g. `attrs.region`). */
export type FieldRef = EntityField | `attrs.${string}`

/** Something tracked by the demo: an instrument, SKU, vehicle, flight, machine... */
export type Entity = {
  id: string // e.g. 'ES', 'SKU-1042', 'N123AB'
  group: string // category, e.g. asset class / product family / aircraft type
  origin: string // where it comes from, e.g. venue / store / hub
  /** Headline numeric value that moves over time (price, stock level, speed...). */
  value: {
    start: number
    decimals: number
    volatility: number
    /** 0-1, pull per update back toward `start`. Default 0 = pure random walk. */
    meanReversion?: number
    /** Depleting stock: each update drains `drain` x start (randomised); below `reorder` x start it is
     *  replenished to about `refill` x start. Replaces the random walk, for inventory-style values. */
    sawtooth?: { drain: number; reorder: number; refill: number }
  }
  /** Extra named dimensions (region, store tier, ...) usable as Kafka headers via `attrs.<name>`.
   *  Every entity must define every attr that any Kafka topic references. */
  attrs?: Record<string, string>
  /** Free-form extras a scenario's generator may use (lot size, tick size, ...). */
  params?: Record<string, number | string>
}

export type EntityModel = {
  /** Human names for the three entity fields, used in copy and the topic legend. */
  labels: { id: string; group: string; origin: string }
  entities: Entity[]
}

// ---------------------------------------------------------------------------
// Kafka side: flat topics + headers, and the bridge that builds the Solace topic
// ---------------------------------------------------------------------------

export type KafkaTopic = {
  name: string // e.g. 'mktdata.quote'
  partitions: number
  keyBy: FieldRef
  /** Kafka header name -> the entity field (or `attrs.<name>`) that supplies its value. */
  headers: Record<string, FieldRef>
  /** Share of generated records that go to this topic (0-1, should sum to ~1 across topics). */
  weight: number
  /** How a record of this topic is shown in tables: two-sided bid/ask, a single value, or a signed change. Default 'value'. */
  render?: 'bidask' | 'value' | 'delta'
  /** Optional JSON Schema path (for the Nisshi live mode later). */
  schema?: string
}

/** The filter controls and column labels of the Kafka-bridge and global-distribution views. */
export type KafkaUi = {
  /** Header the chip row filters on (e.g. 'asset', 'category'), and its label. */
  chipHeader: string
  chipLabel: string
  /** The values of that header, in display order. Position also picks the colour (max 5). */
  chips: { id: string; label: string }[]
  typeLabel: string
  /** Header matched by the free-text box (e.g. 'sym', 'sku'). */
  idHeader: string
  idLabel: string
  idPlaceholder: string
  originLabel: string
  valueLabel: string
  /** Last column: a header's value, or (no `header`) the record's size. */
  extra: { label: string; header?: string }
}

/**
 * One piece of the Solace topic the bridge builds. Using data (not a function) lets one
 * definition drive BOTH the in-browser emulation and the real Kafka Receiver expression.
 */
export type BridgeSegment =
  | { literal: string }
  | { header: string }
  /** The Kafka topic name with `prefix` removed, e.g. prefix 'mktdata.' turns 'mktdata.quote' into 'quote'. */
  | { topicSuffix: string }

export type Bridge = { segments: BridgeSegment[] }

export type ClientLogo = { name: string; short?: string; logo?: string; serif?: boolean }

// ---------------------------------------------------------------------------
// Lifecycle: the state machine for the tracked process (order, shipment, flight...)
// ---------------------------------------------------------------------------

export type LifecycleStage = {
  /** Used as part of the topic, e.g. 'oms/new'. May contain '/'. */
  id: string
  /** Status shown in the tracker while the entity is in/after this stage. */
  status: string
  /** Delay before this stage fires, ms [min, max], measured from the previous stage. */
  delayMs: [number, number]
  /** Default next stage. Omit on terminal stages. */
  next?: string
  /** 0-1: when this stage fires, the item is this fraction filled/fulfilled. Without it, only repeating stages fill. */
  progress?: number
  /** Probabilistic alternatives, checked before `next`. */
  branches?: { to: string; p: number }[]
  /** Stage repeats this many times [min, max] before moving on (e.g. partial fills). */
  repeat?: [number, number]
  /** Tracker status to use for every repeat but the last. */
  statusWhileRepeating?: string
}

export type Lifecycle = {
  /** What one tracked item is called: 'order', 'shipment', 'flight'. */
  noun: string
  /** Id prefix, e.g. 'ORD' gives ORD-7K2. Default 'ORD'. */
  idPrefix?: string
  /** Quantity range per item, multiplied by the entity's `orderLot`. Default [1, 40]. */
  qty?: [number, number]
  /** Topic pattern; placeholders: {stage}, {origin}, {id}, and any key of `facets`. */
  pattern: string
  /** Dimensions that appear in the topic, with their possible values (desk, channel...). */
  facets: Record<string, string[]>
  /** Extra per-item properties that are NOT in the topic but can be shown as columns
   *  (side, strategy, service level...), with their possible values. */
  attributes?: Record<string, string[]>
  stages: LifecycleStage[]
  /** Visual tone per status, for the tracker badges. */
  statuses: { id: string; tone: 'new' | 'ack' | 'partial' | 'done' | 'bad' }[]
}

// ---------------------------------------------------------------------------
// Diagram, sites, consumers
// ---------------------------------------------------------------------------

export type ArchNode = {
  id: string
  label: string
  sub: string
  x: number
  row: 'top' | 'bot'
  /** A CSS variable, e.g. 'var(--cyan)'. */
  color: string
  icon: string
}

export type ArchRoute = {
  /** Subscription that triggers the animation. */
  sub: string
  hops: [string, string][]
  color: string
  /** Fraction of matching events that spawn a particle (0-1). Below 1 also means "high volume": log lines are thinned. */
  sample: number
  /** An extra hop drawn first (e.g. venue -> feed handler), with the hops following half a second later. */
  lead?: { from: string; to: string; color: string }
}

export type Hub = {
  id: string
  name: string
  dc: string
  lon: number
  lat: number
  kind: 'colo' | 'cloud' | 'dc' | 'edge'
  label?: 'l' | 'r' | 'bl' | 'br' | 'tl'
}

export type Sites = {
  hubs: Hub[]
  links: [string, string][]
  /** entity.origin -> hub id of the Kafka cluster that ingests it. */
  ingest: Record<string, string>
  /** Offset [x, y] of the "K" badge relative to a hub on the global map. Default [-8, -28]. */
  kafkaBadge?: Record<string, [number, number]>
  /** Legend text per hub kind on the WAN map. Defaults: Colo, Cloud, Data center, Edge. */
  kindLabels?: Partial<Record<Hub['kind'], string>>
}

/** A consumer at a site, with the subscriptions it can cycle through ("desks" in finance). */
export type Persona = { id: string; site: string; city: string; role: string; subs: string[] }

export type Preset = { sub: string; desc: string }

export type ColumnFormat = 'id' | 'side' | 'text' | 'int' | 'progress' | 'price' | 'status'
/** `key` is one of: id, entity, origin, group, status, qty, filled, avgValue, a lifecycle facet, or a lifecycle attribute. */
/** `weight` is the column's relative width; the default depends on `format`. */
export type Column = { key: string; label: string; format: ColumnFormat; hideSmall?: boolean; weight?: number }
export const BUILTIN_COLUMN_KEYS = ['id', 'entity', 'origin', 'group', 'status', 'qty', 'filled', 'avgValue']

export type Scenario = {
  id: string // folder / URL name, kebab-case
  title: string
  vertical: string
  /** First topic level of every topic this scenario publishes; also the ACL prefix in live mode. */
  topicRoots: string[]

  hero: {
    eyebrow: string
    title: [string, string]
    lede: string
    /** Optional scrolling client strip. Confirm public-use permission for every name. */
    clients?: { label: string; items: ClientLogo[] }
  }
  /** Which sections appear, in order. Numbering in the UI follows this order. */
  sections: SectionId[]
  /** Copy for each section listed in `sections` (others may be omitted). */
  copy: Partial<Record<SectionId, SectionCopy>>

  model: EntityModel
  /** Show the opening ticker tape under the hero. Default true. */
  tape?: boolean
  /** The live watch-list table: a title and one or two value columns (e.g. BID + ASK, or ON HAND).
   *  With `level` it becomes an inventory view: a level bar against the entity's `start` (its target
   *  stock) and a status (ok / low / reorder) instead of a price change. */
  watch: {
    title: string
    columns: string[]
    level?: {
      /** Full width of the bar, as a multiple of `start`. */
      capacity: number
      /** Below this fraction of `start` the status is "low"; below `critical`, "reorder". */
      low: number
      critical: number
      labels: { ok: string; low: string; critical: string; restock: string }
    }
  }
  kafka: { topics: KafkaTopic[]; bridge: Bridge; ui: KafkaUi }
  lifecycle: Lifecycle

  architecture: { nodes: ArchNode[]; routes: ArchRoute[] }
  sites: Sites
  personas: Persona[]
  presets: Preset[]
  /** Labels in the "hybrid" diagram: three boxes on-prem, three in the cloud. */
  hybrid: { onPrem: string[]; cloud: string[] }
  /** What a consumer at a site is called on the global map ("Equities desk"). Empty = just the role. */
  consumerNoun: string
  blotter: {
    title: string
    /** Label of the "no filter" chip. */
    allLabel: string
    /** Lifecycle facet the chips filter on. */
    facet: string
    kpis: { total: string; done: string; bad: string; value?: { label: string; prefix?: string } }
    columns: Column[]
  }
}
