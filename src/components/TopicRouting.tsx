import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { broker, topicMatches } from '../lib/broker'
import { SectionHead, Reveal } from './Section'

const PRESETS = [
  { sub: 'md/futures/CME/>', desc: 'All CME futures quotes' },
  { sub: 'md/*/NASDAQ/*/quote', desc: 'Every NASDAQ quote' },
  { sub: 'md/fx/>', desc: 'All FX, any venue' },
  { sub: 'trade/exec/fill/ALGO/>', desc: 'Fills for the algo desk' },
  { sub: 'trade/*/*/*/*/NVDA', desc: 'NVDA lifecycle, every stage' },
  { sub: 'trade/risk/reject/>', desc: 'Risk rejects (surveillance)' },
  { sub: 'md/*/*/E*/>', desc: 'Prefix wildcard: symbols E*' },
]

type Row = { id: number; topic: string; hit: boolean }

export default function TopicRouting() {
  const [sub, setSub] = useState(PRESETS[0].sub)
  const [rows, setRows] = useState<Row[]>([])
  const [stats, setStats] = useState({ seen: 0, hit: 0 })
  const subRef = useRef(sub)
  subRef.current = sub
  const valid = useMemo(() => /^[^/\s]+(\/[^/\s]+)*$/.test(sub) && !/>./.test(sub.replace(/>$/, '')), [sub])

  useEffect(() => {
    let id = 0
    let buf: Row[] = []
    let seen = 0, hit = 0
    const un = broker.subscribe('>', (m) => {
      const h = topicMatches(subRef.current, m.topic)
      seen++; if (h) hit++
      // keep all hits, sample misses so the stream stays readable
      if (h || Math.random() < 0.18) buf.push({ id: id++, topic: m.topic, hit: h })
    })
    const iv = setInterval(() => {
      if (buf.length) {
        const add = buf.slice(-6).reverse()
        buf = []
        setRows((r) => [...add, ...r].slice(0, 14))
      }
      setStats({ seen, hit })
    }, 220)
    return () => { un(); clearInterval(iv) }
  }, [])

  useEffect(() => setStats({ seen: 0, hit: 0 }), [sub])
  const levels = sub.split('/')

  return (
    <section id="topics" className="fit">
      <div className="wrap two-col">
        <div>
          <SectionHead
            eyebrow="02 · Topic routing"
            title={<>Subscribe to <span className="grad">exactly</span> what you need.</>}
            lede={<>Solace topics are hierarchical and filtered <b>in the broker</b>, not the client. Wildcards like <code>*</code> and <code>&gt;</code> let each app pull a precise slice of millions of instruments — so desks stop drowning in data they throw away.</>}
          />
          <Reveal delay={0.15}>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.sub} className={`chip ${p.sub === sub ? 'on' : ''}`} onClick={() => setSub(p.sub)} title={p.desc}>
                  {p.desc}
                </button>
              ))}
            </div>
            <div className="legend mono">
              <span><b>*</b> one level (or prefix, e.g. <b>E*</b>)</span>
              <span><b>&gt;</b> everything below</span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="panel topic-box">
            <label className="mono topic-label">SUBSCRIPTION</label>
            <div className={`topic-input ${valid ? '' : 'bad'}`}>
              <input value={sub} onChange={(e) => setSub(e.target.value.trim())} spellCheck={false} aria-label="Topic subscription" />
            </div>
            <div className="levels mono">
              {levels.map((l, i) => (
                <motion.span key={i + l} layout className={`lvl ${l === '>' ? 'gt' : l.includes('*') ? 'star' : ''}`}>
                  <em>L{i + 1}</em>{l}
                </motion.span>
              ))}
            </div>
            <div className="topic-stats mono">
              <div><b>{stats.seen.toLocaleString()}</b><span>events on mesh</span></div>
              <div><b className="up">{stats.hit.toLocaleString()}</b><span>delivered to you</span></div>
              <div><b>{stats.seen ? ((1 - stats.hit / stats.seen) * 100).toFixed(1) : '0.0'}%</b><span>filtered at broker</span></div>
            </div>
            <div className="stream mono">
              <AnimatePresence initial={false} mode="popLayout">
                {rows.map((r) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: r.hit ? 1 : 0.28, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`srow ${r.hit ? 'hit' : ''}`}
                  >
                    <span className="dot" />
                    {r.topic}
                    {r.hit && <span className="tag">DELIVERED</span>}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
