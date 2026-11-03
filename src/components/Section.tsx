import { motion } from 'framer-motion'
import { ReactNode } from 'react'

export function Reveal({ children, delay = 0, y = 30 }: { children: ReactNode; delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function SectionHead({ eyebrow, title, lede, split }: { eyebrow: string; title: ReactNode; lede?: ReactNode; split?: boolean }) {
  if (split)
    return (
      <Reveal>
        <div className="fit-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          {lede && <p className="lede">{lede}</p>}
        </div>
      </Reveal>
    )
  return (
    <Reveal>
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {lede && <p className="lede">{lede}</p>}
    </Reveal>
  )
}
