import { afterEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, reloadForStaleBuild } from './chunk-reload'

describe('stale build reload', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('recognises chunk-load errors from Chrome, Firefox and Safari only', () => {
    expect(
      isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /a.js')),
    ).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('reloads once, then not again within a minute (no reload loop)', () => {
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    const err = new TypeError('Importing a module script failed.')
    expect(reloadForStaleBuild(err, 1_000_000)).toBe(true)
    expect(reloadForStaleBuild(err, 1_030_000)).toBe(false)
    expect(reloadForStaleBuild(err, 1_070_000)).toBe(true)
    expect(reloadForStaleBuild(new Error('boom'), 2_000_000)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
