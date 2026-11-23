import { useLayoutEffect } from 'react'

export function usePopoverBounds(root: { current: HTMLDivElement | null }, open: boolean, selector: string) {
 useLayoutEffect(() => {
  if (!open) return
  const position = () => {
   const menu = root.current?.querySelector<HTMLElement>(selector)
   const anchor = root.current?.querySelector<HTMLElement>('button')
   if (!menu || !anchor) return
   menu.style.transform = 'none'
   menu.style.maxHeight = ''
   const edge = 12, gap = 7
   const bounds = root.current?.closest('.modal')?.getBoundingClientRect()
   const minY = Math.max(edge, bounds ? bounds.top + edge : edge)
   const maxY = Math.min(window.innerHeight - edge, bounds ? bounds.bottom - edge : window.innerHeight - edge)
   const trigger = anchor.getBoundingClientRect()
   let rect = menu.getBoundingClientRect()
   const below = Math.max(0, maxY - trigger.bottom - gap)
   const above = Math.max(0, trigger.top - gap - minY)
   const placeAbove = rect.height > below && above > below
   menu.style.maxHeight = `${Math.max(1, placeAbove ? above : below)}px`
   rect = menu.getBoundingClientRect()
   const shiftX = rect.right > window.innerWidth - edge ? window.innerWidth - edge - rect.right
    : rect.left < edge ? edge - rect.left : 0
   const targetY = placeAbove ? trigger.top - gap - rect.height : trigger.bottom + gap
   menu.style.transform = `translate(${shiftX}px,${targetY - rect.top}px)`
  }
  position()
  window.addEventListener('resize', position)
  const onScroll = (event: Event) => {
   const menu = root.current?.querySelector(selector)
   if (event.target instanceof Node && menu?.contains(event.target)) return
   position()
  }
  window.addEventListener('scroll', onScroll, true)
  return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', onScroll, true) }
 }, [open, root, selector])
}
