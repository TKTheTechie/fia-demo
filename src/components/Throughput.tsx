import { animate, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { THROUGHPUT } from '../content'
import { SectionHead, Reveal } from './Section'

// Visual load generator: a particle stream whose density follows the slider.
export default function Throughput() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [load, setLoad] = useState(70)
  const loadRef = useRef(load)
  loadRef.current = load
  const counter = useRef<HTMLSpanElement>(null)
  const inView = useInView(canvas, { margin: '-100px' })

  useEffect(() => {
    if (!inView || !counter.current) return
    const target = load * 120_000
    const from = Number(counter.current.dataset.v || 0)
    const ctl = animate(from, target, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (!counter.current) return
        counter.current.dataset.v = String(v)
        counter.current.textContent = Math.round(v).toLocaleString()
      },
    })
    return () => ctl.stop()
  }, [load, inView])

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    type P = { x: number; y: number; v: number; lane: number; hue: number }
    const ps: P[] = []
    const LANES = 24
    let raf = 0, visible = false
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(c)
    const resize = () => {
      const r = c.getBoundingClientRect()
      c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio
    }
    resize(); window.addEventListener('resize', resize)
    const cs = getComputedStyle(document.documentElement)
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!visible) return
      const w = c.width, h = c.height
      const dark = document.documentElement.dataset.theme !== 'light'
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = dark ? 'rgba(4,6,12,0.28)' : 'rgba(255,255,255,0.32)'
      ctx.fillRect(0, 0, w, h)
      const spawn = Math.floor(loadRef.current * 0.9)
      for (let i = 0; i < spawn; i++) {
        const lane = Math.floor(Math.random() * LANES)
        ps.push({ x: -10, y: ((lane + 0.5) / LANES) * h, v: (6 + Math.random() * 10) * devicePixelRatio * (0.6 + loadRef.current / 100), lane, hue: Math.random() })
      }
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      const brand = cs.getPropertyValue('--brand').trim(), cyan = cs.getPropertyValue('--cyan').trim(), violet = cs.getPropertyValue('--violet').trim()
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.x += p.v
        // converge through the broker "nozzle" in the middle then fan out
        const mid = w / 2
        const d = Math.abs(p.x - mid) / mid
        const targetY = h / 2 + (((p.lane + 0.5) / LANES) * h - h / 2) * Math.pow(d, 0.7)
        p.y += (targetY - p.y) * 0.2
        if (p.x > w + 10) { ps.splice(i, 1); continue }
        ctx.fillStyle = p.hue < 0.5 ? brand : p.hue < 0.8 ? cyan : violet
        ctx.fillRect(p.x, p.y, 10 * devicePixelRatio, 1.6 * devicePixelRatio)
      }
      // broker core
      ctx.globalCompositeOperation = 'source-over'
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.3)
      g.addColorStop(0, brand); g.addColorStop(1, 'transparent')
      ctx.globalAlpha = 0.25 + (loadRef.current / 100) * 0.35
      ctx.fillStyle = g; ctx.fillRect(w / 2 - h * 0.3, 0, h * 0.6, h)
      ctx.globalAlpha = 1
    }
    loop()
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <section id="throughput" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="05 · Throughput"
          title={<><span className="grad">{THROUGHPUT.headline}</span>, without breaking a sweat.</>}
          lede="Open, close, a Fed announcement, an index rebalance — market data bursts are where messaging falls over. Solace absorbs the burst, protects slow consumers, and keeps the fast path fast. Drag the slider to push the load."
        />
        <Reveal delay={0.1}>
          <div className="panel tp">
            <canvas ref={canvas} className="tp-canvas" />
            <div className="tp-hud">
              <div className="tp-count mono"><span ref={counter}>0</span><small>msgs / sec</small></div>
              <label className="tp-slider">
                <span className="mono">LOAD</span>
                <input type="range" min={5} max={100} value={load} onChange={(e) => setLoad(+e.target.value)} />
                <span className="mono">{load}%</span>
              </label>
              <div className="tp-tags">
                {['Burst absorption', 'Per-consumer flow control', 'Message VPNs', 'Guaranteed + direct', 'Replay'].map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          </div>
          <p className="footnote">{THROUGHPUT.note}</p>
        </Reveal>
      </div>
    </section>
  )
}
