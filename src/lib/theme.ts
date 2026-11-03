import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch {}
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }))
  }, [theme])
  return [theme, setTheme] as const
}

// For components that just need to react to the current theme.
export function useThemeValue(): Theme {
  const [t, setT] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || 'dark')
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent).detail)
    window.addEventListener('themechange', on)
    return () => window.removeEventListener('themechange', on)
  }, [])
  return t
}

export function useReducedMotion() {
  const [r, setR] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    setR(m.matches)
    const on = () => setR(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return r
}
