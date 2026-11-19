import type { Assignment } from './assign.ts'
import { partitionOf, stickyAssign } from './assign.ts'

// Solace consumer-scaling model: one queue per application, three access types.
//  exclusive      one active consumer, the rest are hot standbys (failover)
//  non-exclusive  round-robin across all consumers (max throughput, no ordering)
//  partitioned    key-hashed partitions each owned by one consumer; ordering per key
// Rebalancing is incremental: only partitions whose owner changes pause (partition-level handoff).

export type QueueType = 'exclusive' | 'non-exclusive' | 'partitioned'
export const MAX_QUEUE_PARTITIONS = 12

export type Handoff = { at: number; reason: string; moved: number[]; ms: number }

export class SolaceQueue {
  type: QueueType
  partitions: number
  consumers: string[] = []
  assignment: Assignment = []
  stalledUntil: number[] = []
  rr = 0
  handoffs = 0
  last?: Handoff
  /** set while a partition-count change is draining (service affecting) */
  scalingUntil = 0

  name: string
  constructor(name: string, type: QueueType, partitions = 4, consumers = 1) {
    this.name = name
    this.type = type
    this.partitions = partitions
    this.stalledUntil = Array(partitions).fill(0)
    for (let i = 0; i < consumers; i++) this.consumers.push(`${name}-${i + 1}`)
    this.assignment = stickyAssign([], this.partitions, this.consumers).map
  }

  private nextId() { let n = this.consumers.length + 1; while (this.consumers.includes(`${this.name}-${n}`)) n++; return `${this.name}-${n}` }

  private reassign(now: number, reason: string) {
    if (this.type !== 'partitioned') return undefined
    const { map, moved } = stickyAssign(this.assignment, this.partitions, this.consumers)
    this.assignment = map
    if (!moved.length) return undefined
    const ms = 500
    moved.forEach((p) => (this.stalledUntil[p] = now + ms)) // ONLY the moved partitions pause
    this.handoffs++
    this.last = { at: now, reason, moved, ms }
    return this.last
  }

  addConsumer(now: number) { const id = this.nextId(); this.consumers.push(id); return { id, handoff: this.reassign(now, `${id} joined`) } }
  removeConsumer(now: number, id = this.consumers[this.consumers.length - 1]) {
    if (!id) return {}
    this.consumers = this.consumers.filter((c) => c !== id)
    return { id, handoff: this.reassign(now, `${id} left`) }
  }

  setType(t: QueueType, now: number) {
    if (t === this.type) return
    this.type = t
    this.stalledUntil = Array(this.partitions).fill(0)
    this.assignment = t === 'partitioned' ? stickyAssign([], this.partitions, this.consumers).map : []
    this.last = undefined
    void now
  }

  /** Changing the partition count is service affecting: the queue drains, messages in removed partitions are lost. */
  setPartitions(n: number, now: number) {
    n = Math.max(1, Math.min(MAX_QUEUE_PARTITIONS, n))
    if (n === this.partitions) return undefined
    const dropped = n < this.partitions ? this.partitions - n : 0
    this.partitions = n
    this.stalledUntil = Array(n).fill(now + 900)
    this.scalingUntil = now + 900
    this.assignment = stickyAssign(this.assignment, n, this.consumers).map
    return { dropped, serviceAffecting: true }
  }

  /** The consumer that will process this message now, or null if nobody can. */
  route(key: string, now: number): { consumer: string | null; partition: number } {
    if (!this.consumers.length) return { consumer: null, partition: -1 }
    if (this.type === 'exclusive') return { consumer: this.consumers[0], partition: -1 }
    if (this.type === 'non-exclusive') { this.rr = (this.rr + 1) % this.consumers.length; return { consumer: this.consumers[this.rr], partition: -1 } }
    const p = partitionOf(key, this.partitions)
    return { consumer: this.stalledUntil[p] > now ? null : this.assignment[p], partition: p }
  }
  /** Per-key ordering is preserved? */
  get ordered() { return this.type !== 'non-exclusive' || this.consumers.length <= 1 }
  idleConsumers() {
    if (this.type === 'exclusive') return this.consumers.slice(1) // standbys
    if (this.type === 'partitioned') { const used = new Set(this.assignment.filter(Boolean)); return this.consumers.filter((c) => !used.has(c)) }
    return []
  }
}
