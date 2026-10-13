import { fullName, type AssetHistoryItem } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@/utils/format'
import { enumLabel, looseT } from '@/utils/i18n'

type Json = Record<string, unknown> | null

function describe(h: AssetHistoryItem, t: ReturnType<typeof useTranslation>['t']): string | null {
  const tl = looseT(t)
  const oldV = h.oldValue as Json
  const newV = h.newValue as Json
  switch (h.eventType) {
    case 'STATUS_CHANGED': {
      const from = enumLabel(t, 'assetStatus', String(oldV?.status ?? ''))
      const to = enumLabel(t, 'assetStatus', String(newV?.status ?? ''))
      return tl('assets.historyStatus', { from, to })
    }
    case 'MOVED': {
      const place = (v: Json) => [v?.restaurant, v?.location].filter(Boolean).join(' · ')
      return tl('assets.historyMoved', { from: place(oldV), to: place(newV) })
    }
    case 'UPDATED': {
      const fields = (newV?.fields as string[] | undefined) ?? []
      return fields.length
        ? tl('assets.historyFields', {
            fields: fields
              .map((f) => tl(`assets.${f === 'categoryId' ? 'category' : f}`, { defaultValue: f }))
              .join(', '),
          })
        : null
    }
    default:
      return null
  }
}

/** Maintenance history timeline: newest first, who did what and when. */
export function AssetHistory({ items }: { items: AssetHistoryItem[] }) {
  const { t } = useTranslation()
  if (items.length === 0)
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('assets.noHistory')}</p>
    )
  return (
    <ol className="relative grid gap-4 px-4 py-4 before:absolute before:top-5 before:bottom-5 before:left-[1.4rem] before:w-px before:bg-border">
      {items.map((h) => {
        const detail = describe(h, t)
        return (
          <li key={h.id} className="relative grid grid-cols-[0.75rem_1fr] gap-3">
            <span
              aria-hidden
              className="mt-1.5 size-2.5 rounded-full border-2 border-background bg-border-strong ring-1 ring-border"
            />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium">{enumLabel(t, 'assetEventType', h.eventType)}</span>
                {detail && <span className="text-muted-foreground"> · {detail}</span>}
              </p>
              {h.note && <p className="mt-0.5 text-sm text-foreground/80">“{h.note}”</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {h.actor ? `${fullName(h.actor)} · ` : ''}
                <time dateTime={h.occurredAt}>{formatDateTime(h.occurredAt)}</time>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
