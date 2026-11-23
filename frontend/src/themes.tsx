import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = themeOptions.findIndex(option => option.value === theme)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  const choose = (index: number) => { onChange(themeOptions[index].value); setOpen(false) }
  return <div className="theme-control" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <span id={`${id}-label`}>Theme</span>
    <div className="theme-picker">
      <button type="button" className="theme-picker-trigger" role="combobox" aria-label="Website theme"
        aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => { if (!open) setActive(selected); setOpen(!open) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) { setActive(selected); setOpen(true) }
            else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + themeOptions.length) % themeOptions.length)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); setOpen(true); setActive(event.key === 'Home' ? 0 : themeOptions.length - 1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (open) choose(active)
            else { setActive(selected); setOpen(true) }
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false)
          } else if (event.key === 'Tab') setOpen(false)
        }}>
        <span className={`theme-swatch theme-swatch-${theme}`} aria-hidden="true"/>
        <span className="theme-picker-value">{themeOptions[selected].label}</span>
        <ChevronDown size={14} aria-hidden="true" className={open ? 'is-open' : undefined}/>
      </button>
      {open && <div className="theme-picker-menu" id={`${id}-options`} role="listbox" aria-label="Website theme">
        {themeOptions.map((option, index) => <div key={option.value} id={`${id}-option-${index}`}
          role="option" aria-selected={option.value === theme}
          className={`theme-picker-option${index === active ? ' is-active' : ''}`}
          onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
          <span className={`theme-swatch theme-swatch-${option.value}`} aria-hidden="true"/>
          <span>{option.label}</span>
          {option.value === theme && <Check size={14} aria-hidden="true"/>}
        </div>)}
      </div>}
    </div>
  </div>
}
