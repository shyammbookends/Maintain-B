import { AUDIT_ENTITY_TYPE, fullName, type AuditLogDto } from '@maintainx/shared'
import { Download, ScrollText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Can } from '@/components/common/Can'
import { DetailList } from '@/components/common/DetailList'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterSelect, SearchInput } from '@/components/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel } from '@/components/ui/panel'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useRestaurants, useUserOptions } from '@/hooks/useAdminQueries'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { auditApi, useAuditLog } from '@/services/platform.service'
import { reportError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'

const PAGE_SIZE = 50

/** Who did what, when — read-only, newest first. */
export function AuditLogPage() {
  const { t } = useTranslation()
  const restaurants = useRestaurants()
  const users = useUserOptions(undefined)
  const [q, setQ] = useState('')
  const [entityType, setEntityType] = useState<string | undefined>()
  const [actorId, setActorId] = useState<string | undefined>()
  const [restaurantId, setRestaurantId] = useState<string | undefined>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<AuditLogDto | null>(null)
  const [exporting, setExporting] = useState(false)
  const search = useDebouncedValue(q, 300)
  const filters = {
    q: search || undefined,
    entityType,
    actorId,
    restaurantId,
    from: from || undefined,
    to: to || undefined,
  }
  const query = useAuditLog({ ...filters, page, pageSize: PAGE_SIZE })
  const data = query.data
  const totalPages = data?.meta.totalPages ?? 1

  async function exportCsv() {
    setExporting(true)
    try {
      await auditApi.csv(filters)
    } catch (err) {
      reportError(err, t)
    } finally {
      setExporting(false)
    }
  }

  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setPage(1)
    }

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Can permission="audit_logs:export">
            <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
              <Download aria-hidden /> {t('reports.exportCsv')}
            </Button>
          </Can>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchInput value={q} onChange={reset(setQ)} placeholder={t('audit.search')} />
        <FilterSelect
          label={t('audit.record')}
          value={entityType}
          onChange={reset(setEntityType)}
          options={AUDIT_ENTITY_TYPE.map((e) => ({ value: e, label: t(`audit.entity_${e}`) }))}
        />
        <FilterSelect
          label={t('audit.who')}
          value={actorId}
          onChange={reset(setActorId)}
          options={(users.data ?? []).map((u) => ({
            value: u.id,
            label: `${u.firstName} ${u.lastName}`,
          }))}
        />
        {(restaurants.data?.length ?? 0) > 1 && (
          <FilterSelect
            label={t('wo.colRestaurant')}
            value={restaurantId}
            onChange={reset(setRestaurantId)}
            options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
        <div className="grid gap-1">
          <Label htmlFor="audit-from" className="text-xs">
            {t('reports.from')}
          </Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => reset(setFrom)(e.target.value)}
            className="h-9 tabular"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audit-to" className="text-xs">
            {t('reports.to')}
          </Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => reset(setTo)(e.target.value)}
            className="h-9 tabular"
          />
        </div>
      </div>

      <Panel className="overflow-hidden">
        {query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : data!.data.length === 0 ? (
          <EmptyState compact icon={ScrollText} title={t('audit.empty')} />
        ) : (
          <ul className="divide-y">
            {data!.data.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpen(a)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="w-36 shrink-0 text-13 text-muted-foreground tabular">
                    {formatDateTime(a.createdAt)}
                  </span>
                  <code className="text-13 font-medium">{a.action}</code>
                  <Badge tone="outline">{t(`audit.entity_${a.entityType}`)}</Badge>
                  <span className="ml-auto text-13 text-muted-foreground">
                    {a.actor ? fullName(a.actor) : t('wo.system')}
                    {a.restaurant && ` · ${a.restaurant.name}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {data && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('table.previousPage')}
          </Button>
          <span className="text-13 tabular">{t('table.page', { page, pages: totalPages })}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('table.nextPage')}
          </Button>
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent>
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  <code>{open.action}</code>
                </SheetTitle>
                <SheetDescription>{formatDateTime(open.createdAt)}</SheetDescription>
              </SheetHeader>
              <SheetBody className="grid content-start gap-4">
                <DetailList
                  items={[
                    {
                      label: t('audit.who'),
                      value: open.actor ? fullName(open.actor) : t('wo.system'),
                    },
                    {
                      label: t('audit.record'),
                      value: `${t(`audit.entity_${open.entityType}`)}${open.entityId ? ` · ${open.entityId}` : ''}`,
                    },
                    { label: t('wo.fieldRestaurant'), value: open.restaurant?.name },
                    { label: t('audit.ip'), value: open.ip },
                    { label: t('audit.device'), value: open.userAgent },
                    {
                      label: t('audit.requestId'),
                      value: open.requestId && <code className="text-xs">{open.requestId}</code>,
                    },
                  ]}
                />
                {(['oldValue', 'newValue', 'metadata'] as const).map((k) =>
                  open[k] == null ? null : (
                    <div key={k} className="grid gap-1">
                      <p className="text-xs font-medium text-muted-foreground">{t(`audit.${k}`)}</p>
                      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap wrap-break-word">
                        {JSON.stringify(open[k], null, 2)}
                      </pre>
                    </div>
                  ),
                )}
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
