import { useEffect, useState } from 'react'
import highContrast from './themes/high-contrast.css?inline'
import darkMinimal from './themes/dark-minimal.css?inline'
import monochrome from './themes/monochrome.css?inline'
import swissGrid from './themes/swiss.css?inline'

export const themeOptions = [
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'dark-minimal', label: 'Dark Minimal' },
  { value: 'monochrome', label: 'Monochrome' },
  { value: 'swiss-grid', label: 'Swiss Grid' },
] as const
export type Theme = typeof themeOptions[number]['value']
const storageKey = 'tdl-appearance-theme'
const defaultTheme: Theme = 'high-contrast'
const styles: Record<Theme, string> = { 'high-contrast': highContrast, 'dark-minimal': darkMinimal, monochrome, 'swiss-grid': swissGrid }
export const themeTitles: Record<Theme, string> = { 'high-contrast': 'Team operations', 'dark-minimal': 'Workspace overview', monochrome: 'Your workspace', 'swiss-grid': 'Workspace overview' }
const isTheme = (value: unknown): value is Theme => themeOptions.some(option => option.value === value)
function readTheme(): Theme {
  try { const value = localStorage.getItem(storageKey); return isTheme(value) ? value : defaultTheme }
  catch { return defaultTheme }
}
function applyTheme(theme: Theme) {
  let element = document.getElementById('tdl-active-theme') as HTMLStyleElement | null
  if (!element) { element = document.createElement('style'); element.id = 'tdl-active-theme'; document.head.append(element) }
  // Replace the full sheet so rules from a previous theme cannot leak through.
  element.textContent = styles[theme]
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'dark-minimal' ? 'dark' : 'light'
}
export function initializeTheme() { applyTheme(readTheme()) }
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, updateTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) {
        const next = readTheme(); applyTheme(next); updateTheme(next)
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const setTheme = (next: Theme) => {
    if (!isTheme(next)) return
    applyTheme(next); updateTheme(next)
    try { localStorage.setItem(storageKey, next) } catch { /* Selection still works when storage is unavailable. */ }
  }
  return [theme, setTheme]
}
export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return <label className="theme-control"><span>Theme</span><select aria-label="Website theme" value={theme} onChange={event => { if (isTheme(event.target.value)) onChange(event.target.value) }}>
    {themeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>
}
