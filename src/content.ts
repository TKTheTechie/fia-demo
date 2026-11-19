// Scenario-independent copy: the Solace product claims shared by every scenario.
// Domain copy (hero, section titles, ledes) lives in each scenario under src/scenarios/.
// Check these against current Solace collateral before a booth or demo goes live.

export const LATENCY = {
  // illustrative distribution params (microseconds), one row per deployment form
  profiles: [
    { name: 'Hardware appliance', median: 18, p99: 27, color: 'var(--brand)' },
    { name: 'Software broker (tuned)', median: 45, p99: 90, color: 'var(--cyan)' },
    { name: 'Typical cloud message bus', median: 1800, p99: 9000, color: 'var(--sell)' },
  ],
  note: 'Illustrative figures for demo purposes — validate against current Solace benchmarks for your hardware & network.',
}

export const THROUGHPUT = {
  headline: 'Millions of messages per second',
  perBroker: 'Per-broker throughput scales with hardware, from software on a laptop to purpose-built appliances',
  note: 'Illustrative. Actual throughput depends on message size, QoS, fan-out and hardware.',
}

export const FORM_FACTORS = [
  {
    key: 'appliance',
    title: 'Hardware Appliance',
    tag: 'Colo · ultra-low latency',
    body: 'Purpose-built, FPGA-accelerated brokers racked next to the matching engine for deterministic microsecond messaging.',
    icon: 'appliance',
  },
  {
    key: 'software',
    title: 'Software Broker',
    tag: 'Docker · Kubernetes · VM',
    body: 'The same broker as a container or VM. Run it in your DC, on bare metal, or alongside your microservices.',
    icon: 'software',
  },
  {
    key: 'cloud',
    title: 'Cloud Managed',
    tag: 'AWS · Azure · GCP',
    body: 'Fully managed event broker services, deployed in minutes, operated by Solace in the region of your choice.',
    icon: 'cloud',
  },
  {
    key: 'edge',
    title: 'Edge & Branch',
    tag: 'Small footprint',
    body: 'Lightweight brokers at trading desks, branch offices and edge sites — all part of one mesh.',
    icon: 'edge',
  },
]

export const PROTOCOLS = ['SMF', 'MQTT', 'AMQP', 'JMS', 'REST', 'WebSocket', 'Kafka bridge', 'OpenTelemetry']
