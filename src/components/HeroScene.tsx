import { Canvas, useFrame, useThree } from '@react-three/fiber'
import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThemeValue } from '../lib/theme'

const N = 140
const R = 2.1
const PULSES = 220

function buildMesh() {
  const nodes: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const th = golden * i
    nodes.push(new THREE.Vector3(Math.cos(th) * r * R, y * R, Math.sin(th) * r * R))
  }
  const edges: [number, number][] = []
  const seen = new Set<string>()
  nodes.forEach((a, i) => {
    const near = nodes
      .map((b, j) => ({ j, d: a.distanceTo(b) }))
      .filter((x) => x.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 3)
    for (const { j } of near) {
      const k = i < j ? `${i}-${j}` : `${j}-${i}`
      if (!seen.has(k)) { seen.add(k); edges.push([i, j]) }
    }
  })
  // a few long-haul "WAN" links that arc over the surface
  for (let k = 0; k < 18; k++) {
    const i = Math.floor(Math.random() * N), j = Math.floor(Math.random() * N)
    if (i !== j) edges.push([i, j])
  }
  return { nodes, edges }
}

// Arc between two points on a sphere, lifted off the surface for long links.
function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  out.copy(a).lerp(b, t)
  const lift = 1 + a.distanceTo(b) * 0.12 * Math.sin(Math.PI * t)
  return out.setLength(R * lift)
}

function Mesh({ dark }: { dark: boolean }) {
  const group = useRef<THREE.Group>(null!)
  const pulses = useRef<THREE.InstancedMesh>(null!)
  const { nodes, edges } = useMemo(buildMesh, [])
  const { pointer } = useThree()

  const lineGeo = useMemo(() => {
    const pts: number[] = []
    const v = new THREE.Vector3()
    for (const [i, j] of edges) {
      const SEG = 12
      for (let s = 0; s < SEG; s++) {
        arcPoint(nodes[i], nodes[j], s / SEG, v); pts.push(v.x, v.y, v.z)
        arcPoint(nodes[i], nodes[j], (s + 1) / SEG, v); pts.push(v.x, v.y, v.z)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [nodes, edges])

  const nodeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setFromPoints(nodes)
    return g
  }, [nodes])

  const state = useMemo(
    () => Array.from({ length: PULSES }, () => ({
      e: Math.floor(Math.random() * edges.length),
      t: Math.random(),
      speed: 0.25 + Math.random() * 0.9,
      dir: Math.random() > 0.5 ? 1 : -1,
    })),
    [edges.length],
  )
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const v = useMemo(() => new THREE.Vector3(), [])

  const colors = useMemo(() => {
    const palette = dark ? ['#00e0b0', '#2ab7ff', '#8b6cff', '#ffffff'] : ['#00a87d', '#0a84d6', '#6a4cf0', '#0a1428']
    return palette.map((c) => new THREE.Color(c))
  }, [dark])

  useFrame((_, dt) => {
    const g = group.current
    g.rotation.y += dt * 0.06
    g.rotation.x += (pointer.y * 0.3 - g.rotation.x) * 0.03
    g.rotation.z += (-pointer.x * 0.15 - g.rotation.z) * 0.03
    for (let k = 0; k < PULSES; k++) {
      const p = state[k]
      p.t += dt * p.speed
      if (p.t >= 1) {
        // hop to an adjacent edge sharing the endpoint, like a routed message
        const [a, b] = edges[p.e]
        const end = p.dir > 0 ? b : a
        const nexts = edges.map((e, idx) => ({ e, idx })).filter(({ e }) => e[0] === end || e[1] === end)
        const n = nexts[Math.floor(Math.random() * nexts.length)]
        p.e = n.idx
        p.dir = n.e[0] === end ? 1 : -1
        p.t = 0
      }
      const [a, b] = edges[p.e]
      const t = p.dir > 0 ? p.t : 1 - p.t
      arcPoint(nodes[a], nodes[b], t, v)
      tmp.position.copy(v)
      tmp.scale.setScalar(0.5 + 0.5 * Math.sin(p.t * Math.PI))
      tmp.updateMatrix()
      pulses.current.setMatrixAt(k, tmp.matrix)
      pulses.current.setColorAt(k, colors[k % 3])
    }
    pulses.current.instanceMatrix.needsUpdate = true
    if (pulses.current.instanceColor) pulses.current.instanceColor.needsUpdate = true
  })

  const blend = dark ? THREE.AdditiveBlending : THREE.NormalBlending
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[R * 0.985, 64, 64]} />
        <meshBasicMaterial color={dark ? '#06101c' : '#e6eef8'} transparent opacity={dark ? 0.85 : 0.6} />
      </mesh>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={dark ? '#2ab7ff' : '#0a84d6'} transparent opacity={dark ? 0.22 : 0.28} blending={blend} depthWrite={false} />
      </lineSegments>
      <points geometry={nodeGeo}>
        <pointsMaterial color={dark ? '#00e0b0' : '#00a87d'} size={0.05} sizeAttenuation transparent opacity={0.95} blending={blend} depthWrite={false} />
      </points>
      <instancedMesh ref={pulses} args={[undefined, undefined, PULSES]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial toneMapped={false} blending={blend} transparent depthWrite={false} />
      </instancedMesh>
      <Halo dark={dark} />
    </group>
  )
}

function Halo({ dark }: { dark: boolean }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { c: { value: new THREE.Color(dark ? '#00c895' : '#00a87d') }, k: { value: dark ? 1.4 : 0.35 } },
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 c; uniform float k; varying vec3 vN; void main(){ float i = pow(clamp(0.62 - dot(vN, vec3(0,0,1.)), 0., 1.), 4.0); gl_FragColor = vec4(c, i*k); }`,
    }),
    [dark],
  )
  return (
    <mesh material={mat} scale={1.12}>
      <sphereGeometry args={[R, 64, 64]} />
    </mesh>
  )
}

function Stars({ dark }: { dark: boolean }) {
  const geo = useMemo(() => {
    const p = new Float32Array(1500 * 3)
    for (let i = 0; i < p.length; i++) p[i] = (Math.random() - 0.5) * 40
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [])
  const ref = useRef<THREE.Points>(null!)
  useFrame((_, dt) => { ref.current.rotation.y -= dt * 0.01 })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.03} color={dark ? '#8fb3ff' : '#7a8bb0'} transparent opacity={dark ? 0.6 : 0.35} />
    </points>
  )
}

// Sit to the right of the headline on wide screens, centred and faded behind it on narrow ones.
function Placement({ children }: { children: React.ReactNode }) {
  const { viewport } = useThree()
  const wide = viewport.width > 9
  return <group position={[wide ? viewport.width * 0.22 : 0, wide ? 0 : -0.6, 0]} scale={wide ? 1 : 0.85}>{children}</group>
}

export default function HeroScene() {
  const theme = useThemeValue()
  const dark = theme === 'dark'
  return (
    <Canvas camera={{ position: [0, 0, 8.2], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <Placement>
        <Mesh dark={dark} key={theme} />
      </Placement>
      <Stars dark={dark} />
    </Canvas>
  )
}
