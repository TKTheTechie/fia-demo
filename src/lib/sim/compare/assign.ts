// Partition → consumer assignment helpers shared by the Kafka and Solace models.

export type Assignment = (string | null)[] // index = partition, value = consumer id (null = unassigned)

/** Sticky, balanced assignment: every consumer keeps what it already owns up to its fair share,
 *  and only the surplus / orphaned partitions move. Returns the new map and the partitions that moved. */
export function stickyAssign(prev: Assignment, partitions: number, consumers: string[]): { map: Assignment; moved: number[] } {
  const map: Assignment = Array.from({ length: partitions }, (_, p) => (p < prev.length ? prev[p] ?? null : null))
  if (!consumers.length) return { map: map.map(() => null), moved: map.map((_, p) => p).filter((p) => prev[p] != null) }
  const base = Math.floor(partitions / consumers.length)
  const extra = partitions % consumers.length
  // consumers that already own the most get the larger quota, to minimise movement
  const owned = (c: string) => map.filter((x) => x === c).length
  const order = [...consumers].sort((a, b) => owned(b) - owned(a) || consumers.indexOf(a) - consumers.indexOf(b))
  const quota = new Map(order.map((c, i) => [c, base + (i < extra ? 1 : 0)]))
  const free: number[] = []
  const count = new Map(consumers.map((c) => [c, 0]))
  map.forEach((c, p) => {
    if (c && quota.has(c) && count.get(c)! < quota.get(c)!) count.set(c, count.get(c)! + 1)
    else { map[p] = null; free.push(p) }
  })
  for (const c of order) while (count.get(c)! < quota.get(c)! && free.length) { map[free.shift()!] = c; count.set(c, count.get(c)! + 1) }
  const moved = map.map((c, p) => (c !== (prev[p] ?? null) ? p : -1)).filter((p) => p >= 0)
  return { map, moved }
}

/** Fresh round-robin assignment, as an eager rebalance would hand out. */
export const freshAssign = (partitions: number, consumers: string[]): Assignment =>
  Array.from({ length: partitions }, (_, p) => (consumers.length ? consumers[p % consumers.length] : null))

export const hashKey = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
export const partitionOf = (key: string, partitions: number) => hashKey(key) % Math.max(1, partitions)

/** Share of a key population whose partition changes when the partition count changes. */
export function remapShare(keys: string[], from: number, to: number) {
  if (!keys.length) return 0
  return keys.filter((k) => partitionOf(k, from) !== partitionOf(k, to)).length / keys.length
}
