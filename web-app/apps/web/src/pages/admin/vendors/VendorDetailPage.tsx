import {
  type VendorDetail,
  type VendorInvoiceDto,
  type VendorInvoiceInput,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Phone, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import {
  DateField,
  Form,
  FormActions,
  FormRootError,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  applyServerErrors,
  useZodForm,
} from '@/components/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { VendorContracts } from '@/components/vendors/VendorContracts'
import { VendorForm } from '@/components/vendors/VendorForm'
import { VendorPerformanceStrip, VendorWorkOrders } from '@/components/vendors/VendorPerformance'
import { DocumentsPanel } from '@/components/documents/DocumentList'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useInvalidatingMutation, useRestaurants } from '@/hooks/useAdminQueries'
import {
  buyKeys,
  usePurchaseOrders,
  useVendor,
  useVendorInvoices,
  vendorsApi,
} from '@/services/purchasing.service'
import { describeError, reportError } from '@/utils/errors'
import { formatCurrency, formatDate } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { StatusBadge } from '@/components/common/StatusBadge'

export function VendorDetailPage() {
  const { t } = useTranslation()
  const { vendorId = '' } = useParams()
  const query = useVendor(vendorId)
  const back = { to: '/vendors', label: t('vendors.title') }
  if (query.isPending)
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (query.isError)
    return (
      <>
        <PageHeader title={t('vendors.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  return <Detail v={query.data} back={back} />
}

function Detail({ v, back }: { v: VendorDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const archive = useInvalidatingMutation(() => vendorsApi.archive(v.id), [buyKeys.vendors])
  const orders = usePurchaseOrders({ vendorId: v.id, pageSize: 10 })

  return (
    <>
      <PageHeader
        back={back}
        title={v.name}
        meta={
          <div className="flex flex-wrap gap-1">
            {v.categories.map((c) => (
              <Badge key={c} tone="outline">
                {enumLabel(t, 'vendorCategory', c)}
              </Badge>
            ))}
          </div>
        }
        actions={
          <>
            {v.phone && (
              <Button asChild variant="secondary">
                <a href={`tel:${v.phone.replace(/\s/g, '')}`}>
                  <Phone aria-hidden /> {t('vendors.call')}
                </a>
              </Button>
            )}
            <Can permission="purchase_orders:create">
              <Button asChild variant="secondary">
                <Link to={`/purchase-orders/new?vendorId=${v.id}`}>
                  <ShoppingCart aria-hidden /> {t('po.new')}
                </Link>
              </Button>
            </Can>
            {v.can.edit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t('actions.edit')}
              </Button>
            )}
            {v.can.delete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('vendors.archive')}
                onClick={() => setArchiving(true)}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <VendorPerformanceStrip v={v} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.details')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <DetailList
                items={[
                  { label: t('vendors.contact'), value: v.contactName },
                  {
                    label: t('vendors.phone'),
                    value: [v.phone, v.altPhone].filter(Boolean).join(', '),
                  },
                  {
                    label: t('vendors.email'),
                    value: v.email && (
                      <a href={`mailto:${v.email}`} className="text-primary hover:underline">
                        {v.email}
                      </a>
                    ),
                  },
                  {
                    label: t('vendors.address'),
                    value: [v.address, v.city].filter(Boolean).join(', '),
                  },
                  { label: t('vendors.taxId'), value: v.taxId },
                  {
                    label: t('vendors.serves'),
                    value: v.restaurants.length
                      ? v.restaurants.map((r) => r.name).join(', ')
                      : t('procedures.allRestaurants'),
                  },
                  {
                    label: t('vendors.partsSupplied'),
                    value: v.partCount ? (
                      <Link
                        to={`/inventory?vendorId=${v.id}`}
                        className="text-primary hover:underline"
                      >
                        {v.partCount}
                      </Link>
                    ) : (
                      '0'
                    ),
                  },
                  { label: t('vendors.assetsServiced'), value: String(v.assetCount) },
                ]}
              />
              {v.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{v.notes}</p>}
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader className="flex items-center justify-between gap-2">
              <PanelTitle>{t('po.title')}</PanelTitle>
              <Link
                to={`/purchase-orders?vendorId=${v.id}`}
                className="text-13 font-medium text-primary"
              >
                {t('actions.viewAll')}
              </Link>
            </PanelHeader>
            {!orders.data || orders.data.data.length === 0 ? (
              <PanelBody>
                <p className="text-13 text-muted-foreground">{t('po.noneForVendor')}</p>
              </PanelBody>
            ) : (
              <ul className="divide-y">
                {orders.data.data.map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/purchase-orders/${o.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="text-13 font-medium tabular">{o.code}</span>
                      <StatusBadge kind="purchaseOrderStatus" value={o.status} />
                      <span className="ml-auto text-13 tabular">{formatCurrency(o.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <VendorContracts vendor={v} />
          <VendorWorkOrders v={v} />
          <Invoices vendor={v} />
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('documents.pageTitle')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <DocumentsPanel ownerType="VENDOR" ownerId={v.id} ownerName={v.name} />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('vendors.edit')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <VendorForm
                vendor={v}
                onCancel={() => setEditing(false)}
                onDone={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        tone="destructive"
        title={t('vendors.archiveTitle', { name: v.name })}
        description={t('vendors.archiveBody')}
        confirmLabel={t('vendors.archive')}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(undefined)
            toast.success(t('vendors.archived'))
            navigate('/vendors', { replace: true })
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

function Invoices({ vendor }: { vendor: VendorDetail }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useVendorInvoices(vendor.id)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<VendorInvoiceDto | null>(null)
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: buyKeys.invoices(vendor.id) }),
      qc.invalidateQueries({ queryKey: buyKeys.vendor(vendor.id) }),
    ])

  async function togglePaid(i: VendorInvoiceDto, paid: boolean) {
    try {
      await vendorsApi.setPaid(vendor.id, i.id, paid)
      await refresh()
    } catch (err) {
      reportError(err, t)
    }
  }

  return (
    <Panel className="content-start">
      <PanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <PanelTitle>{t('invoices.title')}</PanelTitle>
          <p className="text-13 text-muted-foreground">
            {t('invoices.summary', {
              spend: formatCurrency(vendor.spend12m),
              unpaid: formatCurrency(vendor.unpaidAmount),
            })}
          </p>
        </div>
        {vendor.can.edit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> {t('invoices.add')}
          </Button>
        )}
      </PanelHeader>
      {query.isPending ? (
        <PanelBody>
          <Skeleton className="h-24 w-full" />
        </PanelBody>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : query.data.length === 0 ? (
        <PanelBody>
          <p className="text-13 text-muted-foreground">{t('invoices.empty')}</p>
        </PanelBody>
      ) : (
        <ul className="divide-y">
          {query.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium tabular">{i.invoiceNumber}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(`${i.invoiceDate}T00:00:00`)}
                  {i.restaurant && ` · ${i.restaurant.name}`}
                  {i.purchaseOrder && ` · ${i.purchaseOrder.code}`}
                  {i.dueDate &&
                    !i.paidAt &&
                    ` · ${t('invoices.due', { date: formatDate(`${i.dueDate}T00:00:00`) })}`}
                </span>
              </span>
              <span className="text-sm font-medium tabular">{formatCurrency(i.amount)}</span>
              {i.overdue && <Badge tone="danger">{t('invoices.overdue')}</Badge>}
              {vendor.can.edit ? (
                <label className="flex items-center gap-2 text-13">
                  <Checkbox
                    checked={!!i.paidAt}
                    onCheckedChange={(c) => void togglePaid(i, c === true)}
                  />
                  {t('invoices.paid')}
                </label>
              ) : (
                i.paidAt && <Badge tone="success">{t('invoices.paid')}</Badge>
              )}
              {vendor.can.edit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('invoices.delete', { number: i.invoiceNumber })}
                  onClick={() => setDeleting(i)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <InvoiceDialog
          vendor={vendor}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            await refresh()
            setAdding(false)
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="destructive"
        title={t('invoices.deleteTitle', { number: deleting?.invoiceNumber ?? '' })}
        description={t('invoices.deleteBody')}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          try {
            await vendorsApi.deleteInvoice(vendor.id, deleting!.id)
            await refresh()
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

const ALL = '__all__'
/** API schema, but the restaurant select uses ALL for "not linked to a restaurant". */
const invoiceForm = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(60),
    amount: z.number().positive('validation.positiveAmount').max(1_000_000_000),
    invoiceDate: z.iso.date(),
    dueDate: z.iso.date().or(z.literal('')),
    restaurantId: z.string().min(1, 'validation.selectOption'),
    purchaseOrderId: z.literal(''),
    notes: z.string().trim().max(1000),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.invoiceDate, {
    message: 'validation.endBeforeStart',
    path: ['dueDate'],
  })

function InvoiceDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: VendorDetail
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const restaurants = useRestaurants()
  const choices = (restaurants.data ?? []).filter(
    (r) => vendor.restaurants.length === 0 || vendor.restaurants.some((x) => x.id === r.id),
  )
  const form = useZodForm(invoiceForm, {
    defaultValues: {
      invoiceNumber: '',
      amount: undefined as unknown as number,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: '',
      restaurantId: choices.length === 1 ? choices[0]!.id : user.isSuperAdmin ? ALL : '',
      purchaseOrderId: '',
      notes: '',
    },
  })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const input: VendorInvoiceInput = {
        ...v,
        restaurantId: v.restaurantId === ALL ? '' : v.restaurantId,
      }
      await vendorsApi.addInvoice(vendor.id, input)
      toast.success(t('invoices.added'))
      await onSaved()
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('invoices.add')}</DialogTitle>
          <DialogDescription>{vendor.name}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="invoiceNumber"
                label={t('invoices.number')}
                required
              />
              <NumberField
                control={form.control}
                name="amount"
                label={t('invoices.amount')}
                required
                min={0}
                step={0.01}
                suffix="₹"
              />
              <DateField
                control={form.control}
                name="invoiceDate"
                label={t('invoices.date')}
                required
              />
              <DateField
                control={form.control}
                name="dueDate"
                label={t('invoices.dueDate')}
                optional
              />
            </div>
            <SelectField
              control={form.control}
              name="restaurantId"
              label={t('wo.fieldRestaurant')}
              required={!user.isSuperAdmin}
              placeholder={t('validation.selectOption')}
              options={[
                ...(user.isSuperAdmin ? [{ value: ALL, label: t('invoices.noRestaurant') }] : []),
                ...choices.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <TextareaField
              control={form.control}
              name="notes"
              label={t('vendors.notes')}
              optional
              rows={2}
            />
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
