import { capitalMarkets } from './capital-markets/index.ts'
import { retailSupplyChain } from './retail-supply-chain/index.ts'
import type { Scenario } from './types.ts'

// Registry of built-in scenarios. Add new ones here.
export const SCENARIOS: Scenario[] = [capitalMarkets, retailSupplyChain]

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id)

export type { Scenario } from './types.ts'
