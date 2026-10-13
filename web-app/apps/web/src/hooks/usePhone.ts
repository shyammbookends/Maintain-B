import { useSyncExternalStore } from 'react'

/** Same breakpoint as styles/mobile.css: below Tailwind's `lg` (1024px). */
export const PHONE_QUERY = '(max-width: 1023.98px)'

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(PHONE_QUERY) ?? null
}

function subscribe(onChange: () => void) {
  const m = media()
  if (!m) return () => {}
  if (typeof m.addEventListener === 'function') {
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }
  m.addListener?.(onChange)
  return () => m.removeListener?.(onChange)
}

const snapshot = () => Boolean(media()?.matches)

/**
 * True on phones and small tablets (< 1024px), where the app switches to the
 * phone layout (the same design as the Flutter app). Phone-only markup is
 * rendered only when this is true, so the desktop page is never touched.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
