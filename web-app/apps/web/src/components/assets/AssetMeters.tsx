import {
  METER_DEFAULT_UNIT,
  METER_TYPE,
  fullName,
  meterReadingSchema,
  meterSchema,
  type AssetMeterDto,
  type MeterType,
} from '@maintainx/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gauge, History, Pencil, Plus, SearchCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import {
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { useAuth } from '@/contexts/AuthContext'
import { metersApi } from '@/services/assets.service'
import { cn } from '@/utils/cn'
import { describeError, isQueuedOffline, reportError } from '@/utils/errors'
import { formatDateTime, formatNumber, formatRelative } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const key = (assetId: string) => ['assets', 'meters', assetId] as const

/**
 * Meters on an asset with their latest value; technicians record readings,
 * managers add or change meters. Readings can trigger automations
 * ("every 500 h → service").
 */
export function AssetMeters({ assetId, large = false }: { assetId: string; large?: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: key(assetId),
    queryFn: ({ signal }) => metersApi.list(assetId, signal),
  })
  const [reading, setReading] = useState<AssetMeterDto | null>(null)
  const [history, setHistory] = useState<AssetMeterDto | null>(null)
  const [editing, setEditing] = useState<AssetMeterDto | 'new' | null>(null)
  const [removing, setRemoving] = useState<AssetMeterDto | null>(null)
  const set = (rows: AssetMeterDto[]) => {
    qc.setQueryData(key(assetId), rows)
    // A reading can create a meter-based PM job (and moves its next due reading).
    void qc.invalidateQueries({ queryKey: ['pm-schedules'] })
    void qc.invalidateQueries({ queryKey: ['work-orders'] })
  }
  const { can } = useAuth()
  const manage = can('meters:edit')

  if (query.isPending)
    return (
      <Panel>
        <PanelBody>
          <Skeleton className="h-16 w-full" />
        </PanelBody>
      </Panel>
    )
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
  // No meters and nobody here to add one: nothing to show.
  if (query.data.length === 0 && !manage) return null

  return (
    <Panel>
      <PanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" aria-hidden /> {t('meters.title')}
        </PanelTitle>
        {manage && (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('meters.add')}
          </Button>
        )}
      </PanelHeader>
      {query.data.length === 0 && (
        <PanelBody>
          <p className="text-13 text-muted-foreground">{t('meters.empty')}</p>
        </PanelBody>
      )}
      <ul className="divide-y">
        {query.data.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{m.name}</span>
              <span className="block text-xs text-muted-foreground">
                {enumLabel(t, 'meterType', m.type)}
                {m.lastReadingAt && ` · ${formatRelative(m.lastReadingAt)}`}
              </span>
            </span>
            <span className="text-base font-semibold tabular">
              {m.currentValue === null ? '—' : `${formatNumber(m.currentValue)} ${m.unit}`}
            </span>
            <span className="flex gap-1">
              {m.can.read && (
                <Button size={large ? 'lg' : 'sm'} onClick={() => setReading(m)}>
                  {t('meters.record')}
                </Button>
              )}
              {m.readings.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('meters.history', { name: m.name })}
                  onClick={() => setHistory(m)}
                >
                  <History />
                </Button>
              )}
              {m.can.manage && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('meters.edit', { name: m.name })}
                    onClick={() => setEditing(m)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('meters.remove', { name: m.name })}
                    onClick={() => setRemoving(m)}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {reading && (
        <ReadingDialog
          assetId={assetId}
          meter={reading}
          onClose={() => setReading(null)}
          set={set}
        />
      )}
      {history && <HistoryDialog meter={history} onClose={() => setHistory(null)} />}
      {editing && (
        <MeterDialog
          assetId={assetId}
          meter={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          set={set}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('meters.removeTitle', { name: removing?.name ?? '' })}
        description={t('meters.removeBody')}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          try {
            set(await metersApi.archive(assetId, removing!.id))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

function ReadingDialog({
  assetId,
  meter,
  onClose,
  set,
}: {
  assetId: string
  meter: AssetMeterDto
  onClose: () => void
  set: (rows: AssetMeterDto[]) => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(meterReadingSchema, {
    defaultValues: { value: undefined as unknown as number, note: '' },
  })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      set(await metersApi.read(assetId, meter.id, v))
      toast.success(t('meters.recorded'))
      onClose()
    } catch (err) {
      if (isQueuedOffline(err)) {
        // Saved on the device; recording it again would add a second reading.
        toast.info(t('offline.queued'))
        onClose()
        return
      }
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meters.record')}</DialogTitle>
          <DialogDescription>
            {meter.name}
            {meter.currentValue !== null &&
              ` · ${t('meters.last', { value: formatNumber(meter.currentValue), unit: meter.unit })}`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <NumberField
              control={form.control}
              name="value"
              label={t('meters.value')}
              required
              step={0.001}
              suffix={meter.unit}
            />
            <TextField control={form.control} name="note" label={t('meters.note')} optional />
            <FormActions>
              <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({ meter, onClose }: { meter: AssetMeterDto; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meters.historyTitle', { name: meter.name })}</DialogTitle>
          <DialogDescription>{t('meters.historyHint')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">{t('stock.when')}</th>
                <th className="py-2 text-right font-medium">{t('meters.value')}</th>
                <th className="py-2 text-right font-medium">{t('meters.change')}</th>
                <th className="py-2 pl-3 font-medium">{t('stock.byWhom')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {meter.readings.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-13 whitespace-nowrap">{formatDateTime(r.readAt)}</td>
                  <td className="py-2 text-right tabular">
                    {formatNumber(r.value)} {meter.unit}
                  </td>
                  <td
                    className={cn(
                      'py-2 text-right tabular',
                      r.delta !== null && r.delta < 0 && 'text-danger-fg',
                    )}
                  >
                    {r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${formatNumber(r.delta)}`}
                  </td>
                  <td className="py-2 pl-3 text-13">
                    {fullName(r.user)}
                    {r.note && (
                      <span className="block text-xs text-muted-foreground">{r.note}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MeterDialog({
  assetId,
  meter,
  onClose,
  set,
}: {
  assetId: string
  meter: AssetMeterDto | null
  onClose: () => void
  set: (rows: AssetMeterDto[]) => void
}) {
  const { t } = useTranslation()
  const form = useZodForm(meterSchema, {
    defaultValues: meter
      ? { name: meter.name, type: meter.type, unit: meter.unit }
      : { name: '', type: 'RUNTIME_HOURS', unit: 'h' },
  })
  // Picking a type fills in its usual unit.
  const type = form.watch('type')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const unit = METER_DEFAULT_UNIT[type as MeterType]
    if (unit) form.setValue('unit', unit)
  }, [type, form])
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      set(meter ? await metersApi.update(assetId, meter.id, v) : await metersApi.create(assetId, v))
      onClose()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meter ? t('meters.editTitle') : t('meters.add')}</DialogTitle>
          <DialogDescription>{t('meters.addHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <TextField
              control={form.control}
              name="name"
              label={t('meters.name')}
              placeholder={t('meters.namePlaceholder')}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="type"
                label={t('meters.type')}
                required
                options={METER_TYPE.map((m) => ({ value: m, label: enumLabel(t, 'meterType', m) }))}
              />
              <TextField control={form.control} name="unit" label={t('meters.unit')} required />
            </div>
            <FormActions>
              <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {t('actions.save')}
              </Button>
            </FormActions>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** Root cause analyses recorded on this asset's jobs. */
export function AssetRootCauses({ assetId }: { assetId: string }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['assets', 'root-causes', assetId],
    queryFn: ({ signal }) => metersApi.rootCauses(assetId, signal),
  })
  if (!query.data || query.data.length === 0) return null
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <SearchCheck className="size-4 text-muted-foreground" aria-hidden /> {t('rca.assetTitle')}
        </PanelTitle>
      </PanelHeader>
      <ul className="divide-y">
        {query.data.map((r) => (
          <li key={r.id} className="grid gap-1 px-4 py-2.5">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="outline">{enumLabel(t, 'failureCategory', r.category)}</Badge>
              <Link
                to={`/work-orders/${r.workOrder.id}`}
                className="text-13 font-medium text-primary tabular hover:underline"
              >
                {r.workOrder.code}
              </Link>
              <span className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</span>
            </span>
            <span className="text-sm">{r.rootCause}</span>
            {r.preventiveAction && (
              <span className="text-xs text-muted-foreground">
                {t('rca.preventive')}: {r.preventiveAction}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
