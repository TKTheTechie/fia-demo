// A tiny in-browser event broker with Solace-style topic semantics.
// Levels are '/'-delimited. '*' matches one level (or a level prefix, e.g. "AA*"),
// '>' as the final level matches one or more remaining levels.
// The whole page is wired through this bus — every tick, order and fill is a topic.

export type Message<T = unknown> = { topic: string; payload: T; ts: number }
type Handler<T> = (msg: Message<T>) => void

export function topicMatches(sub: string, topic: string): boolean {
  const s = sub.split('/')
  const t = topic.split('/')
  for (let i = 0; i < s.length; i++) {
    const lvl = s[i]
    if (lvl === '>' && i === s.length - 1) return t.length > i
    if (i >= t.length) return false
    if (lvl === '*') continue
    if (lvl.endsWith('*')) {
      if (!t[i].startsWith(lvl.slice(0, -1))) return false
      continue
    }
    if (lvl !== t[i]) return false
  }
  return s.length === t.length
}

class Broker {
  private subs = new Map<number, { sub: string; fn: Handler<any> }>()
  private next = 1
  published = 0

  subscribe<T>(sub: string, fn: Handler<T>): () => void {
    const id = this.next++
    this.subs.set(id, { sub, fn })
    return () => this.subs.delete(id)
  }

  publish<T>(topic: string, payload: T) {
    this.published++
    const msg = { topic, payload, ts: performance.now() }
    for (const { sub, fn } of this.subs.values()) {
      if (topicMatches(sub, topic)) fn(msg)
    }
  }
}

export const broker = new Broker()
