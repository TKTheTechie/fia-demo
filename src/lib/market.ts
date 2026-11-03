import { broker } from './broker'

export type Instrument = {
  sym: string
  venue: string
  asset: 'equities' | 'fx' | 'futures' | 'rates' | 'crypto'
  px: number
  dp: number
  vol: number
}

export const INSTRUMENTS: Instrument[] = [
  { sym: 'ES', venue: 'CME', asset: 'futures', px: 6012.25, dp: 2, vol: 0.00018 },
  { sym: 'NQ', venue: 'CME', asset: 'futures', px: 21344.5, dp: 2, vol: 0.00024 },
  { sym: 'ZN', venue: 'CBOT', asset: 'rates', px: 110.515, dp: 3, vol: 0.00006 },
  { sym: 'CL', venue: 'NYMEX', asset: 'futures', px: 71.42, dp: 2, vol: 0.00035 },
  { sym: 'GC', venue: 'COMEX', asset: 'futures', px: 2741.3, dp: 1, vol: 0.0002 },
  { sym: 'AAPL', venue: 'NASDAQ', asset: 'equities', px: 228.52, dp: 2, vol: 0.0003 },
  { sym: 'NVDA', venue: 'NASDAQ', asset: 'equities', px: 141.87, dp: 2, vol: 0.0005 },
  { sym: 'JPM', venue: 'NYSE', asset: 'equities', px: 224.19, dp: 2, vol: 0.00025 },
  { sym: 'EURUSD', venue: 'EBS', asset: 'fx', px: 1.08542, dp: 5, vol: 0.00008 },
  { sym: 'USDJPY', venue: 'EBS', asset: 'fx', px: 152.314, dp: 3, vol: 0.0001 },
  { sym: 'GBPUSD', venue: 'LSEG', asset: 'fx', px: 1.29873, dp: 5, vol: 0.00009 },
  { sym: 'BTC', venue: 'CME', asset: 'crypto', px: 69420, dp: 0, vol: 0.0007 },
]

export type Tick = { sym: string; bid: number; ask: number; last: number; size: number; chg: number }

export const marketTopic = (i: Instrument) => `md/${i.asset}/${i.venue}/${i.sym}/quote`

const open = new Map(INSTRUMENTS.map((i) => [i.sym, i.px]))
let started = false

// Feed handler simulation: random-walk quotes published onto the bus.
export function startMarket() {
  if (started) return
  started = true
  const loop = () => {
    const burst = 2 + Math.floor(Math.random() * 4)
    for (let k = 0; k < burst; k++) {
      const i = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)]
      const drift = (Math.random() - 0.5) * 2 * i.vol * i.px
      i.px = Math.max(0.0001, i.px + drift)
      const spread = i.px * 0.00005 + Math.pow(10, -i.dp)
      const tick: Tick = {
        sym: i.sym,
        bid: i.px - spread / 2,
        ask: i.px + spread / 2,
        last: i.px,
        size: Math.ceil(Math.random() * 50) * (i.asset === 'equities' ? 100 : 1),
        chg: ((i.px - open.get(i.sym)!) / open.get(i.sym)!) * 100,
      }
      broker.publish(marketTopic(i), tick)
    }
    setTimeout(loop, 60 + Math.random() * 120)
  }
  loop()
}

export const fmt = (v: number, dp: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
