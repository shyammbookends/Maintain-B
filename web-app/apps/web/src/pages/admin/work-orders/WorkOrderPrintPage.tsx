import { fullName, type ChecklistItemDto, type WorkOrderDetail } from '@maintainx/shared'
import { ArrowLeft, Printer } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { rangeLabel, visibleSteps } from '@/components/checklists/checklist-utils'
import { CustomFieldValues } from '@/components/common/CustomFieldInputs'
import { ErrorState } from '@/components/common/ErrorState'
import { LabelList } from '@/components/common/LabelChip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BrandMark } from '@/layouts/BrandMark'
import { useWorkOrder } from '@/services/work-orders.service'
import { formatCurrency, formatDateTime, formatDuration, formatNumber } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

/**
 * A clean, printable work order (browser "Print → Save as PDF" makes the PDF;
 * no PDF library, nothing extra to download). Shows what a manager or an
 * auditor needs: details, checklist answers, parts, costs, the repair report,
 * photos and signatures.
 */
export function WorkOrderPrintPage() {
  const { t } = useTranslation()
  const { workOrderId = '' } = useParams()
  const query = useWorkOrder(workOrderId)
  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/work-orders/${workOrderId}`}>
            <ArrowLeft aria-hidden /> {t('print.back')}
          </Link>
        </Button>
        <span className="flex-1" />
        <Button size="sm" onClick={() => window.print()} disabled={!query.data}>
          <Printer aria-hidden /> {t('print.print')}
        </Button>
      </div>
      <main className="mx-auto max-w-3xl px-6 py-6 print:max-w-none print:px-0 print:py-0">
        {query.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <PrintBody w={query.data} />
        )}
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="mb-2 border-b pb-1 text-sm font-semibold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

function answer(i: ChecklistItemDto, t: TFunction): string {
  if (i.result === null) return t('print.notAnswered')
  if (i.inputType === 'NUMBER' && i.numericValue !== null)
    return `${formatNumber(i.numericValue)}${i.unit ? ` ${i.unit}` : ''} (${enumLabel(t, 'stepResult', i.result)})`
  if ((i.inputType === 'TEXT' || i.inputType === 'MULTIPLE_CHOICE') && i.textValue)
    return i.textValue
  return enumLabel(t, 'stepResult', i.result)
}

function PrintBody({ w }: { w: WorkOrderDetail }) {
  const { t } = useTranslation()
  const steps = visibleSteps(w.checklist)
  const photos = w.attachments.filter((a) => a.kind === 'PHOTO' && !a.removed)
  const signatures = w.checklist.flatMap((s) =>
    s.inputType === 'SIGNATURE' ? s.attachments.filter((a) => !a.removed) : [],
  )
  return (
    <article className="text-foreground">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs text-muted-foreground tabular">{w.code}</p>
          <h1 className="text-xl font-semibold">{w.title}</h1>
          <p className="mt-1 text-sm">
            {enumLabel(t, 'workOrderStatus', w.status)} · {enumLabel(t, 'priority', w.priority)} ·{' '}
            {enumLabel(t, 'workOrderCategory', w.category)}
          </p>
          <LabelList labels={w.labels} className="mt-2" />
        </div>
        <BrandMark />
      </header>

      <Section title={t('print.details')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 print:grid-cols-3">
          <Field label={t('wo.fieldRestaurant')} value={w.restaurant.name} />
          <Field label={t('wo.fieldLocation')} value={w.location?.name} />
          <Field label={t('wo.fieldAsset')} value={w.asset ? `${w.asset.name} · ${w.asset.assetCode}` : null} />
          <Field
            label={t('wo.fieldAssignee')}
            value={w.assignedUser ? fullName(w.assignedUser) : w.assignedTeam?.name}
          />
          <Field label={t('print.createdBy')} value={`${fullName(w.createdBy)} · ${formatDateTime(w.createdAt)}`} />
          <Field label={t('wo.fieldDue')} value={w.dueDate && formatDateTime(w.dueDate)} />
          <Field label={t('print.started')} value={w.startedAt && formatDateTime(w.startedAt)} />
          <Field label={t('print.completed')} value={w.completedAt && formatDateTime(w.completedAt)} />
          <Field label={t('wo.timeWorked')} value={w.minutesWorked > 0 ? formatDuration(w.minutesWorked) : null} />
        </dl>
        {w.description && <p className="mt-3 text-sm whitespace-pre-wrap">{w.description}</p>}
        <div className="mt-3">
          <CustomFieldValues entity="WORK_ORDER" values={w.customFields} />
        </div>
      </Section>

      {steps.length > 0 && (
        <Section title={t('print.checklist')}>
          <table className="w-full text-sm">
            <tbody>
              {steps.map((s) =>
                s.inputType === 'SECTION' ? (
                  <tr key={s.id}>
                    <th colSpan={2} className="pt-3 pb-1 text-left text-xs font-semibold uppercase">
                      {s.title}
                    </th>
                  </tr>
                ) : (
                  <tr key={s.id} className="border-b align-top">
                    <td className="py-1.5 pr-4">
                      {s.position}. {s.title}
                      {s.inputType === 'NUMBER' && rangeLabel(s, t) && (
                        <span className="block text-xs text-muted-foreground">{rangeLabel(s, t)}</span>
                      )}
                      {s.note && <span className="block text-xs italic">{s.note}</span>}
                    </td>
                    <td className="py-1.5 text-right font-medium whitespace-nowrap">{answer(s, t)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </Section>
      )}

      {w.parts.length > 0 && (
        <Section title={t('print.parts')}>
          <table className="w-full text-sm">
            <tbody>
              {w.parts.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-1.5">
                    {p.part.name} <span className="text-xs text-muted-foreground">{p.part.partNumber}</span>
                  </td>
                  <td className="py-1.5 text-right tabular">
                    {formatNumber(p.qtyUsed)} {p.part.unit}
                  </td>
                  <td className="py-1.5 text-right tabular">
                    {p.unitCost !== null ? formatCurrency(p.qtyUsed * p.unitCost) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {w.cost.total > 0 && (
        <Section title={t('print.cost')}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5 print:grid-cols-5">
            <Field label={t('print.costParts')} value={formatCurrency(w.cost.parts)} />
            <Field label={t('print.costLabour')} value={formatCurrency(w.cost.labour)} />
            <Field label={t('print.costVendor')} value={formatCurrency(w.cost.vendor)} />
            <Field label={t('print.costOther')} value={formatCurrency(w.cost.other)} />
            <Field label={t('print.costTotal')} value={<strong>{formatCurrency(w.cost.total)}</strong>} />
          </dl>
        </Section>
      )}

      {w.completion && (
        <Section title={t('completion.reportTitle')}>
          <dl className="grid gap-2">
            <Field label={t('completion.problemFound')} value={w.completion.problemFound} />
            <Field label={t('completion.rootCause')} value={w.completion.rootCause} />
            <Field label={t('completion.workPerformed')} value={w.completion.workPerformed} />
            <Field
              label={t('completion.finalCondition')}
              value={enumLabel(t, 'finalCondition', w.completion.finalCondition)}
            />
            <Field label={t('completion.recommendation')} value={w.completion.recommendation} />
            <Field
              label={t('completion.confirmedBy')}
              value={`${fullName(w.completion.confirmedBy)} · ${formatDateTime(w.completion.confirmedAt)}`}
            />
          </dl>
        </Section>
      )}

      {photos.length > 0 && (
        <Section title={t('print.photos')}>
          <ul className="grid grid-cols-3 gap-2 print:grid-cols-4">
            {photos.slice(0, 12).map((a) => (
              <li key={a.id} className="break-inside-avoid">
                <img
                  src={a.thumbUrl ?? a.url}
                  alt={a.caption ?? a.fileName}
                  className="aspect-square w-full rounded border object-cover"
                />
                {a.stage && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {enumLabel(t, 'evidenceStage', a.stage)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {signatures.length > 0 && (
        <Section title={t('print.signatures')}>
          <ul className="flex flex-wrap gap-4">
            {signatures.map((a) => (
              <li key={a.id}>
                <img src={a.url} alt={t('print.signature')} className="h-20 rounded border bg-white" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        {t('print.footer', { time: formatDateTime(new Date().toISOString()) })}
      </p>
    </article>
  )
}
