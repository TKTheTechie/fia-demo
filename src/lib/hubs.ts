// Broker sites on the global mesh, shared by the WAN map and global distribution views.

export type Hub = { id: string; name: string; dc: string; lon: number; lat: number; kind: 'colo' | 'cloud' | 'dc'; label?: 'l' | 'r' | 'bl' | 'br' | 'tl' }

export const HUBS: Hub[] = [
  { id: 'CHI', name: 'Chicago', dc: 'Aurora · CME colo', lon: -88.3, lat: 41.76, kind: 'colo', label: 'tl' },
  { id: 'NY4', name: 'New Jersey', dc: 'Secaucus · NY4', lon: -74.06, lat: 40.79, kind: 'colo', label: 'r' },
  { id: 'USE', name: 'N. Virginia', dc: 'AWS us-east-1', lon: -77.5, lat: 39.0, kind: 'cloud', label: 'bl' },
  { id: 'LD4', name: 'London', dc: 'Slough · LD4', lon: -0.6, lat: 51.5, kind: 'colo', label: 'l' },
  { id: 'FR2', name: 'Frankfurt', dc: 'Eurex · FR2', lon: 8.68, lat: 50.11, kind: 'colo' },
  { id: 'SG1', name: 'Singapore', dc: 'SGX · SG1', lon: 103.85, lat: 1.29, kind: 'colo' },
  { id: 'TY3', name: 'Tokyo', dc: 'JPX · TY3', lon: 139.69, lat: 35.68, kind: 'colo' },
  { id: 'HK1', name: 'Hong Kong', dc: 'HKEX', lon: 114.17, lat: 22.32, kind: 'dc', label: 'br' },
  { id: 'SYD', name: 'Sydney', dc: 'Azure australiaeast', lon: 151.2, lat: -33.86, kind: 'cloud' },
  { id: 'SAO', name: 'São Paulo', dc: 'B3', lon: -46.63, lat: -23.55, kind: 'dc' },
  { id: 'MUM', name: 'Mumbai', dc: 'GCP asia-south1', lon: 72.88, lat: 19.07, kind: 'cloud', label: 'l' },
]
export const LINKS: [string, string][] = [
  ['CHI', 'NY4'], ['NY4', 'USE'], ['NY4', 'LD4'], ['CHI', 'LD4'], ['LD4', 'FR2'], ['LD4', 'SG1'], ['FR2', 'MUM'],
  ['MUM', 'SG1'], ['SG1', 'HK1'], ['HK1', 'TY3'], ['HK1', 'LD4'], ['SG1', 'SYD'], ['NY4', 'SAO'], ['TY3', 'SYD'], ['USE', 'SAO'],
]
