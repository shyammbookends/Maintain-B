/**
 * After a new deploy, an open tab still asks for the previous build's
 * code-split files, which no longer exist: the lazy route fails to load.
 * Reloading picks up the new build. Done at most once a minute so a real
 * outage can't put the page in a reload loop.
 */

const KEY = 'mx-chunk-reload-at'
const MIN_GAP_MS = 60_000

/** Chrome, Firefox and Safari word this differently. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    message,
  )
}

/** Reloads the page for a stale-build error; returns true when it did. */
export function reloadForStaleBuild(error: unknown, now = Date.now()): boolean {
  if (!isChunkLoadError(error)) return false
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0)
  } catch {
    // Storage blocked: still reload once for this page view.
  }
  if (now - last < MIN_GAP_MS) return false
  try {
    sessionStorage.setItem(KEY, String(now))
  } catch {
    // ignore
  }
  window.location.reload()
  return true
}
