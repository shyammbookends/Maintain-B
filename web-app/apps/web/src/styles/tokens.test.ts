import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * WCAG contrast guard for the design tokens. Reads index.css directly, so any
 * colour edit that breaks legibility fails the build.
 */

// Not `new URL('./index.css', import.meta.url)`: Vite rewrites that pattern into an asset URL.
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css'),
  'utf8',
)

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

function token(name: string): [number, number, number] {
  const m = rootBlock.match(
    new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`),
  )
  if (!m) throw new Error(`token --${name} not found as oklch() in :root`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** OKLCH → relative luminance (WCAG 2.x). */
function luminance([L, C, h]: [number, number, number]): number {
  const rad = (h * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(fg: string, bg: string): number {
  const a = luminance(token(fg))
  const b = luminance(token(bg))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const AA_TEXT = 4.5
const AA_UI = 3 // non-text UI: focus rings, status dots, input borders are paired with text

describe('design token contrast (WCAG AA)', () => {
  const textPairs: Array<[string, string]> = [
    ['foreground', 'background'],
    ['foreground', 'canvas'],
    ['foreground', 'muted'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'muted'],
    ['muted-foreground', 'canvas'],
    ['secondary-foreground', 'secondary'],
    ['primary-foreground', 'primary'],
    ['primary-foreground', 'primary-hover'],
    ['primary', 'background'],
    ['destructive-foreground', 'destructive'],
    ['destructive-foreground', 'destructive-hover'],
    ['sidebar-foreground', 'sidebar'],
    ['sidebar-accent-foreground', 'sidebar-accent'],
  ]

  for (const tone of ['neutral', 'info', 'warning', 'success', 'danger', 'review']) {
    textPairs.push([`${tone}-fg`, `${tone}-soft`], [`${tone}-fg`, 'background'])
  }

  it.each(textPairs)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each([['ring', 'background']])('%s on %s ≥ 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_UI)
  })

  it('sanity: black on white is 21:1', () => {
    const white = luminance([1, 0, 0])
    const black = luminance([0, 0, 0])
    expect((white + 0.05) / (black + 0.05)).toBeCloseTo(21, 0)
  })
})
