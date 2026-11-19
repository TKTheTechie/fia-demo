import { useState } from 'react'
import { ScalingAct, TopicsAct } from './Compare'
import KafkaBridge from './KafkaBridge'
import { Reveal, ScenarioHead } from './Section'

// One Kafka section, three tabs: how topics and ordering differ, how consumers scale, and the
// in-broker Kafka bridge. Every tab stays mounted (hidden when inactive) so its state survives a
// tab switch; hidden panes are off-screen so their simulations pause themselves.

const TABS = [
  { id: 'topics', label: 'Topics & ordering' },
  { id: 'scaling', label: 'Consumer scaling' },
  { id: 'bridge', label: 'Kafka bridge' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function Kafka() {
  const [tab, setTab] = useState<Tab>('topics')
  return (
    <section id="kafka" className="fit cmp">
      <div className="wrap">
        <ScenarioHead id="kafka" split />
        <Reveal delay={0.1}>
          <div className="kt-tabs mono" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} data-tab={t.id} className={`kt-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div hidden={tab !== 'topics'}><TopicsAct /></div>
          <div hidden={tab !== 'scaling'}><ScalingAct /></div>
          <div hidden={tab !== 'bridge'}><KafkaBridge /></div>
        </Reveal>
      </div>
    </section>
  )
}
