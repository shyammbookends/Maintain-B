import type { SearchHit, SearchKind, SearchResults } from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import {
  Boxes,
  ClipboardList,
  Inbox,
  ListChecks,
  MapPin,
  Package,
  Search,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { http } from '@/services/http'
import { cn } from '@/utils/cn'

const ICON: Record<SearchKind, LucideIcon> = {
  workOrder: ClipboardList,
  request: Inbox,
  asset: Package,
  part: Boxes,
  location: MapPin,
  vendor: Truck,
  procedure: ListChecks,
}

/**
 * One search box for everything (work orders, requests, assets, parts,
 * locations, vendors, procedures). Opens with the header button, Ctrl+K / ⌘K
 * or "/"; arrow keys and Enter pick a result.
 */
export function GlobalSearch() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('search.open')}
        className="flex h-9 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden lg:inline">{t('search.placeholder')}</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[11px] font-medium lg:inline">
          Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-xl" showClose={false}>
          {open && <SearchPanel onPick={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function SearchPanel({ onPick }: { onPick: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const listId = useId()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebouncedValue(text.trim(), 250)
  const query = useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) =>
      http.get<{ data: SearchResults }>('/search', { query: { q }, signal }).then((r) => r.data),
    enabled: q.length >= 2,
    staleTime: 30_000,
  })
  const hits = q.length >= 2 ? (query.data?.hits ?? []) : []
  useEffect(() => setActive(0), [q])

  function go(hit: SearchHit) {
    onPick()
    navigate(hit.url)
  }

  return (
    <div className="grid">
      <DialogTitle className="sr-only">{t('search.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('search.hint')}</DialogDescription>
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
          aria-label={t('search.title')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault()
              go(hits[active])
            }
          }}
          placeholder={t('search.placeholder')}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {query.isFetching && <Spinner className="size-4" />}
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-2">
        {q.length < 2 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('search.hint')}</p>
        ) : query.isError ? (
          <p className="px-3 py-6 text-center text-sm text-danger-fg">{t('search.failed')}</p>
        ) : query.data && hits.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('search.none', { q })}
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label={t('search.results')} className="grid gap-0.5">
            {hits.map((h, i) => {
              const Icon = ICON[h.kind]
              const first = i === 0 || hits[i - 1]!.kind !== h.kind
              return (
                <li key={`${h.kind}-${h.id}`} role="presentation">
                  {first && (
                    <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                      {t(`search.kind_${h.kind}`)}
                    </p>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
                      i === active && 'bg-accent',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      {h.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {h.subtitle}
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
