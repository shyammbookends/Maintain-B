import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

export interface BarItem {
  key: string
  label: ReactNode
  value: number
  /** Bar fill class; defaults to the first chart colour (one hue = magnitude). */
  barClass?: string
  /** Optional drill-down link for the row. */
  to?: string
}

/**
 * Horizontal bars with the value written next to every bar (no legend needed,
 * colour never carries meaning alone). Bars share one scale.
 */
export function BarList({
  items,
  max,
  format = formatNumber,
}: {
  items: BarItem[]
  max?: number
  format?: (v: number) => string
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="grid gap-2.5">
      {items.map((item) => {
        const row = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-13">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="font-semibold tabular">{format(item.value)}</span>
            </span>
            <span className="mt-1 block h-2 rounded-full bg-muted">
              <span
                className={cn(
                  'block h-full rounded-full transition-[width] duration-(--duration-slow)',
                  item.barClass ?? 'bg-chart-1',
                )}
                style={{ width: item.value > 0 ? `max(4px, ${(item.value / top) * 100}%)` : 0 }}
              />
            </span>
          </>
        )
        return (
          <li key={item.key}>
            {item.to ? (
              <Link
                to={item.to}
                className="block rounded-md px-1 py-0.5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                title={`${typeof item.label === 'string' ? item.label : ''} ${format(item.value)}`}
              >
                {row}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
