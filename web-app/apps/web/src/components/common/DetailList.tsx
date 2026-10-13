import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'

export interface DetailItem {
  label: ReactNode
  value: ReactNode
  /** Hide the row entirely (e.g. progressive disclosure, or empty optional fields). */
  hidden?: boolean
}

interface DetailListProps {
  items: DetailItem[]
  className?: string
}

/** Label / value pairs for record detail views. Empty values render as an em dash. */
export function DetailList({ items, className }: DetailListProps) {
  const { t } = useTranslation()
  return (
    <dl className={cn('text-sm', className)}>
      {items
        .filter((item) => !item.hidden)
        .map((item, i) => {
          const empty = item.value === null || item.value === undefined || item.value === ''
          return (
            <div
              key={i}
              className="grid gap-0.5 border-b py-2.5 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:gap-6"
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 text-foreground">
                {empty ? (
                  <span className="text-muted-foreground" aria-label={t('common.none')}>
                    —
                  </span>
                ) : (
                  item.value
                )}
              </dd>
            </div>
          )
        })}
    </dl>
  )
}
