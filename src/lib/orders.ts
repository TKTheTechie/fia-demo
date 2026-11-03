import { broker } from './broker'
import { INSTRUMENTS, Tick, marketTopic } from './market'

// Simulated order flow: OMS -> pre-trade risk -> EMS -> venue -> fills -> post-trade.
// Every hop is a topic publish, so any component (blotter, diagrams, counters)
// can tap in with a wildcard subscription.

export type OrderStatus = 'NEW' | 'ACK' | 'PARTIAL' | 'FILLED' | 'REJECTED' | 'CANCELLED'
export type Order = {
  id: string
  sym: string
  side: 'BUY' | 'SELL'
  qty: number
  filled: number
  px: number
  avgPx: number
  desk: string
  venue: string
  strategy: string
  status: OrderStatus
  t: number
  latencyUs: number
}

const DESKS = ['DELTA1', 'MACRO', 'ALGO', 'VOL', 'FXSPOT']
const STRATS = ['VWAP', 'TWAP', 'POV', 'SNIPER', 'ICEBERG', 'DMA']
const last = new Map<string, Tick>()
let seq = 482_000
let started = false

export function startOrders() {
  if (started) return
  started = true
  for (const i of INSTRUMENTS) broker.subscribe<Tick>(marketTopic(i), (m) => last.set(i.sym, m.payload))

  const spawn = () => {
    const inst = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)]
    const tick = last.get(inst.sym)
    const px = tick ? tick.last : inst.px
    const side = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const lot = inst.asset === 'equities' ? 100 : inst.asset === 'fx' ? 1_000_000 : 1
    const order: Order = {
      id: `ORD-${(seq++).toString(36).toUpperCase()}`,
      sym: inst.sym,
      side,
      qty: (1 + Math.floor(Math.random() * 40)) * lot,
      filled: 0,
      px,
      avgPx: 0,
      desk: DESKS[Math.floor(Math.random() * DESKS.length)],
      venue: inst.venue,
      strategy: STRATS[Math.floor(Math.random() * STRATS.length)],
      status: 'NEW',
      t: Date.now(),
      latencyUs: 0,
    }
    const emit = (stage: string) =>
      broker.publish(`trade/${stage}/${order.desk}/${order.venue}/${order.sym}`, { ...order })

    emit('oms/new')
    setTimeout(() => {
      emit('risk/check')
      if (Math.random() < 0.04) {
        order.status = 'REJECTED'
        emit('risk/reject')
        return
      }
      setTimeout(() => {
        order.status = 'ACK'
        order.latencyUs = +(2 + Math.random() * 6).toFixed(1)
        emit('ems/route')
        let fills = 1 + Math.floor(Math.random() * 3)
        const doFill = () => {
          const remaining = order.qty - order.filled
          const q = fills === 1 ? remaining : Math.ceil((remaining * (0.3 + Math.random() * 0.4)) / lot) * lot
          const fpx = (last.get(order.sym)?.last ?? order.px) * (1 + (Math.random() - 0.5) * 0.0002)
          order.avgPx = (order.avgPx * order.filled + fpx * q) / (order.filled + q)
          order.filled += q
          order.status = order.filled >= order.qty ? 'FILLED' : 'PARTIAL'
          emit('exec/fill')
          fills--
          if (fills > 0) setTimeout(doFill, 300 + Math.random() * 900)
          else setTimeout(() => emit('post/clear'), 400)
        }
        setTimeout(doFill, 250 + Math.random() * 500)
      }, 180)
    }, 160)
    setTimeout(spawn, 350 + Math.random() * 700)
  }
  spawn()
}
