import type { Assignment } from './assign.ts'
import { freshAssign, partitionOf, remapShare, stickyAssign } from './assign.ts'

// Kafka consumer-scaling model: partitions, a consumer group (classic eager or KIP-848 incremental)
// or a share group (KIP-932, production-ready in Kafka 4.2). Pure state + events; the UI drives time.

export type KafkaMode = 'classic' | 'kip848' | 'share'
export const MAX_PARTITIONS = 12

export type Rebalance = {
  at: number
  reason: string
  /** partitions that stop being consumed while the rebalance runs */
  stalled: number[]
  /** how long they are stalled, in ms of sim time */
  ms: number
  /** whole-group stop? */
  stopTheWorld: boolean
}

export class KafkaGroup {
  mode: KafkaMode = 'classic'
  partitions: number
  consumers: string[] = []
  assignment: Assignment = []
  /** partition → time (ms) until which it is stalled by a rebalance */
  stalledUntil: number[] = []
  last?: Rebalance
  rebalances = 0
  /** records that arrived for a partition whose consumer was stalled */
  idle = new Set<string>()

  constructor(partitions: number, consumers = 0) {
    this.partitions = partitions
    this.stalledUntil = Array(partitions).fill(0)
    for (let i = 0; i < consumers; i++) this.consumers.push(`c${i + 1}`)
    this.assignment = freshAssign(partitions, this.consumers)
  }

  private nextId() { let n = this.consumers.length + 1; while (this.consumers.includes(`c${n}`)) n++; return `c${n}` }

  /** Rebalance cost (ms). Classic eager: everyone stops, group-wide. KIP-848: only moved partitions pause, briefly. */
  private rebalance(now: number, reason: string, next: Assignment, moved: number[]): Rebalance | undefined {
    if (this.mode === 'share') { this.assignment = next; return undefined }
    const stw = this.mode === 'classic'
    const stalled = stw ? next.map((_, p) => p) : moved
    const ms = stw ? 2600 : 700
    if (!stalled.length) { this.assignment = next; return undefined }
    this.assignment = next
    stalled.forEach((p) => (this.stalledUntil[p] = now + ms))
    this.rebalances++
    this.last = { at: now, reason, stalled, ms, stopTheWorld: stw }
    return this.last
  }

  addConsumer(now: number) {
    const id = this.nextId()
    this.consumers.push(id)
    const r = this.mode === 'classic' ? freshAssign(this.partitions, this.consumers) : stickyAssign(this.assignment, this.partitions, this.consumers).map
    const moved = r.map((c, p) => (c !== this.assignment[p] ? p : -1)).filter((p) => p >= 0)
    return { id, rebalance: this.rebalance(now, `${id} joined`, r, moved) }
  }

  removeConsumer(now: number, id = this.consumers[this.consumers.length - 1]) {
    if (!id) return {}
    this.consumers = this.consumers.filter((c) => c !== id)
    const r = this.mode === 'classic' ? freshAssign(this.partitions, this.consumers) : stickyAssign(this.assignment, this.partitions, this.consumers).map
    const moved = r.map((c, p) => (c !== this.assignment[p] ? p : -1)).filter((p) => p >= 0)
    return { id, rebalance: this.rebalance(now, `${id} left`, r, moved) }
  }

  /** Kafka can only ADD partitions. Returns the share of keys whose partition changed (ordering break). */
  addPartition(now: number, keys: string[]) {
    if (this.partitions >= MAX_PARTITIONS) return undefined
    const from = this.partitions
    this.partitions++
    this.stalledUntil.push(0)
    const r = this.mode === 'classic' ? freshAssign(this.partitions, this.consumers) : stickyAssign(this.assignment, this.partitions, this.consumers).map
    const moved = r.map((c, p) => (c !== this.assignment[p] ? p : -1)).filter((p) => p >= 0)
    const rebalance = this.rebalance(now, `partition ${from} added`, r, moved)
    return { remapped: remapShare(keys, from, this.partitions), rebalance }
  }

  /** Consumers beyond the partition count do nothing (not in share mode). */
  idleConsumers() {
    if (this.mode === 'share') return []
    const used = new Set(this.assignment.filter(Boolean))
    return this.consumers.filter((c) => !used.has(c))
  }

  setMode(m: KafkaMode, now: number) {
    this.mode = m
    const next = m === 'classic' ? freshAssign(this.partitions, this.consumers) : stickyAssign(this.assignment, this.partitions, this.consumers).map
    this.assignment = next
    this.stalledUntil.fill(0)
    void now
  }

  /** Who may process a record on this partition right now? Group modes: the owner (unless stalled). Share: anyone. */
  owner(p: number, now: number): string | null {
    if (this.mode === 'share') return null
    return this.stalledUntil[p] > now ? null : this.assignment[p]
  }
  partitionFor(key: string) { return partitionOf(key, this.partitions) }
  canProcess(p: number, now: number) {
    if (!this.consumers.length) return false
    if (this.mode === 'share') return true
    return this.owner(p, now) != null
  }
}
