import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/utils/cn'
import { formatDayMonth, formatNumber } from '@/utils/format'

export interface TrendSeries {
  key: string
  label: string
  /** Tailwind text-color class for the line (stroke uses currentColor), e.g. text-chart-1. */
  colorClass: string
  /** Swatch class for legend/tooltip, e.g. bg-chart-1. */
  swatchClass: string
  values: number[]
}

const H = 180
const PAD = { top: 12, right: 12, bottom: 24, left: 32 }

/** Up to ~5 round ticks from 0 to just above max. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

/**
 * Line chart for a daily series (one shared y-axis, never two). Hovering or
 * focusing shows a crosshair and the exact values for that day.
 */
export function TrendChart({
  dates,
  series,
  label,
}: {
  /** YYYY-MM-DD per point. */
  dates: string[]
  series: TrendSeries[]
  label: string
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  // Track the container width so the SVG draws at real pixel size (crisp 2px lines).
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = Math.max(0, ...series.flatMap((s) => s.values))
  const yTicks = useMemo(() => ticks(max), [max])
  const top = yTicks[yTicks.length - 1] || 1
  const n = dates.length
  const innerW = width - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH
  const every = Math.max(1, Math.ceil(n / 6))

  const onMove = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const rel = (clientX - rect.left - PAD.left) / innerW
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))))
  }

  return (
    <figure className="grid min-w-0 grid-cols-1 gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-13 text-muted-foreground">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn('h-0.5 w-4 rounded-full', s.swatchClass)} aria-hidden />
            {s.label}
            <span className="font-medium text-foreground tabular">
              {formatNumber(s.values.reduce((a, b) => a + b, 0))}
            </span>
          </li>
        ))}
      </ul>
      <div
        ref={box}
        className="relative min-w-0"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          width={width}
          height={H}
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          className="block focus-visible:outline-2 focus-visible:outline-ring"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1))
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1))
            if (e.key === 'Escape') setHover(null)
          }}
          onBlur={() => setHover(null)}
        >
          <desc id={`${id}-desc`}>{label}</desc>
          {yTicks.map((tv) => (
            <g key={tv}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tv)}
                y2={y(tv)}
                className="stroke-chart-grid"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(tv)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular"
              >
                {formatNumber(tv)}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={d}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground text-[11px]"
              >
                {formatDayMonth(`${d}T12:00:00`)}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {series.map((s) => (
            <g key={s.key} className={s.colorClass}>
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              />
              {hover !== null && (
                <circle
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4}
                  fill="currentColor"
                  className="stroke-card"
                  strokeWidth={2}
                />
              )}
            </g>
          ))}
        </svg>
        {hover !== null && dates[hover] && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(x(hover) + 10, 0), width - 150),
            }}
          >
            <p className="mb-1 font-medium">{formatDayMonth(`${dates[hover]}T12:00:00`)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={cn('size-2 rounded-full', s.swatchClass)} aria-hidden />
                  {s.label}
                </span>
                <span className="font-semibold tabular">{formatNumber(s.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
