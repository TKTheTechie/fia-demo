import { useEffect, useRef, useState } from 'react'
import { LATENCY } from '../content'
import { useThemeValue } from '../lib/theme'
import { SectionHead, Reveal } from './Section'

// log-normal sampler matched to a median and p99
function sampler(median: number, p99: number) {
  const mu = Math.log(median)
  const sigma = (Math.log(p99) - mu) / 2.326
  return () => {
    const u = 1 - Math.random(), v = Math.random()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.exp(mu + sigma * z)
  }
}

const MIN = 5, MAX = 50_000, BINS = 90
const binOf = (us: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((Math.log10(us) - Math.log10(MIN)) / (Math.log10(MAX) - Math.log10(MIN))) * BINS)))
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export default function Latency() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const theme = useThemeValue()
  const [p, setP] = useState(LATENCY.profiles.map(() => ({ p50: 0, p99: 0, n: 0 })))
  const [race, setRace] = useState(0)

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const samplers = LATENCY.profiles.map((x) => sampler(x.median, x.p99))
    const hist = LATENCY.profiles.map(() => new Float32Array(BINS))
    const samples = LATENCY.profiles.map(() => [] as number[])
    const colors = ['--brand', '--cyan', '--sell'].map(cssVar)
    const muted = cssVar('--muted'), line = cssVar('--line-strong')
    let raf = 0, frame = 0, visible = false
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(c)

    const resize = () => {
      const r = c.getBoundingClientRect()
      c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!visible) return
      frame++
      samplers.forEach((s, i) => {
        for (let k = 0; k < 40; k++) {
          const v = s()
          hist[i][binOf(v)] += 1
          samples[i].push(v)
        }
        if (samples[i].length > 4000) samples[i].splice(0, 2000)
        for (let b = 0; b < BINS; b++) hist[i][b] *= 0.992
      })
      const w = c.width, h = c.height, pad = 36 * devicePixelRatio
      ctx.clearRect(0, 0, w, h)
      // axis
      ctx.strokeStyle = line; ctx.lineWidth = 1
      ctx.font = `${11 * devicePixelRatio}px JetBrains Mono`
      ctx.fillStyle = muted; ctx.textAlign = 'center'
      for (const t of [10, 100, 1000, 10000]) {
        const x = pad + ((Math.log10(t) - Math.log10(MIN)) / (Math.log10(MAX) - Math.log10(MIN))) * (w - pad * 2)
        ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.moveTo(x, pad * 0.4); ctx.lineTo(x, h - pad); ctx.stroke()
        ctx.fillText(t >= 1000 ? `${t / 1000} ms` : `${t} µs`, x, h - pad * 0.35)
      }
      ctx.setLineDash([])
      const max = Math.max(...hist.map((hh) => Math.max(...hh)))
      hist.forEach((hh, i) => {
        const bw = (w - pad * 2) / BINS
        const g = ctx.createLinearGradient(0, pad, 0, h - pad)
        g.addColorStop(0, colors[i]); g.addColorStop(1, 'transparent')
        ctx.beginPath()
        ctx.moveTo(pad, h - pad)
        for (let b = 0; b < BINS; b++) {
          const y = h - pad - (hh[b] / max) * (h - pad * 1.6)
          ctx.lineTo(pad + b * bw + bw / 2, y)
        }
        ctx.lineTo(w - pad, h - pad); ctx.closePath()
        ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fill()
        ctx.globalAlpha = 1; ctx.strokeStyle = colors[i]; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke()
      })
      if (frame % 15 === 0) {
        setP(samples.map((s) => {
          const sorted = [...s].sort((a, b) => a - b)
          return { p50: sorted[Math.floor(sorted.length * 0.5)], p99: sorted[Math.floor(sorted.length * 0.99)], n: s.length }
        }))
      }
    }
    draw()
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', resize) }
  }, [theme])

  const fmtUs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} ms` : `${v.toFixed(1)} µs`)

  return (
    <section id="latency" className="fit">
      <div className="wrap">
        <SectionHead
          split
          eyebrow="03 · Low latency"
          title={<>Microseconds, <span className="grad">deterministically</span>.</>}
          lede="When the alpha decays in microseconds, jitter is the enemy. Solace delivers low, flat, predictable latency — the tail matters as much as the median."
        />
        <Reveal delay={0.1}>
          <div className="lat-grid">
            <div className="panel lat-chart">
              <canvas ref={canvas} />
            </div>
            <div className="lat-cards">
              {LATENCY.profiles.map((x, i) => (
                <div key={x.name} className="panel lat-card" style={{ ['--c' as string]: x.color }}>
                  <div className="lat-name"><i />{x.name}</div>
                  <div className="lat-nums mono">
                    <div><span>p50</span><b>{p[i].p50 ? fmtUs(p[i].p50) : '—'}</b></div>
                    <div><span>p99</span><b>{p[i].p99 ? fmtUs(p[i].p99) : '—'}</b></div>
                  </div>
                </div>
              ))}
              <button className="panel race-btn" onClick={() => setRace((r) => r + 1)}>
                <span>▶ Race a message</span>
                <div className="race">
                  {LATENCY.profiles.map((x) => (
                    <div key={x.name} className="lane">
                      <i key={race} style={{ background: x.color, animationDuration: `${Math.min(6, 0.25 + Math.log10(x.median) * 1.1 - 1)}s`, animationPlayState: race ? 'running' : 'paused' }} />
                    </div>
                  ))}
                </div>
              </button>
            </div>
          </div>
          <p className="footnote">{LATENCY.note}</p>
        </Reveal>
      </div>
    </section>
  )
}
