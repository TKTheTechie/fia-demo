import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles.css'
import App from './App'
import { ScenarioContext, resolveScenario } from './lib/scenario'
import { startLifecycle } from './lib/sim/lifecycle'
import { startStream } from './lib/sim/stream'

// One scenario per page load, chosen with ?scenario=<id> (default: the first registered).
const scenario = resolveScenario(location.search)
document.documentElement.dataset.scenario = scenario.id
startStream(scenario)
startLifecycle(scenario)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScenarioContext.Provider value={scenario}>
      <App />
    </ScenarioContext.Provider>
  </React.StrictMode>,
)
