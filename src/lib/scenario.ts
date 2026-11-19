import { createContext, useContext } from 'react'
import { SCENARIOS } from '../scenarios/index.ts'
import type { Scenario } from '../scenarios/types.ts'

export const DEFAULT_SCENARIO = SCENARIOS[0]

/**
 * Picks the scenario from `?scenario=<id>`. Accepts a unique prefix, so `?scenario=retail` works.
 * Unknown values fall back to the default, with a console warning. A scenario is chosen once at
 * page load (switching = reload), which keeps the simulation and every section consistent.
 */
export function resolveScenario(search: string): Scenario {
  const want = new URLSearchParams(search).get('scenario')
  if (!want) return DEFAULT_SCENARIO
  const exact = SCENARIOS.find((s) => s.id === want)
  if (exact) return exact
  const prefixed = SCENARIOS.filter((s) => s.id.startsWith(want))
  if (prefixed.length === 1) return prefixed[0]
  console.warn(`Unknown or ambiguous scenario "${want}". Known: ${SCENARIOS.map((s) => s.id).join(', ')}. Using ${DEFAULT_SCENARIO.id}.`)
  return DEFAULT_SCENARIO
}

export const ScenarioContext = createContext<Scenario>(DEFAULT_SCENARIO)
export const useScenario = () => useContext(ScenarioContext)

/** 1-based, zero-padded position of a section in the scenario, for eyebrows like "03 · Latency". */
export const sectionNumber = (sc: Scenario, id: string) => String(sc.sections.indexOf(id as never) + 1).padStart(2, '0')
