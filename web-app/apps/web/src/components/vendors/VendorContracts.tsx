import {
  vendorContractSchema,
  type ContractState,
  type VendorContractDto,
  type VendorDetail,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
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
import { Badge, type BadgeTone } from '@/components/ui/badge'
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
import { useCurrentUser } from '@/contexts/AuthContext'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { buyKeys, useVendorContracts, vendorsApi } from '@/services/purchasing.service'
import { describeError, reportError } from '@/utils/errors'
import { formatCurrency, formatDate } from '@/utils/format'

const STATE_TONE: Record<ContractState, BadgeTone> = {
  upcoming: 'info',
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
}

const day = (d: string) => formatDate(`${d}T00:00:00`)

/** Service agreements (AMC, rate contracts) with this vendor. */
export function VendorContracts({ vendor }: { vendor: VendorDetail }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useVendorContracts(vendor.id)
  const [editing, setEditing] = useState<VendorContractDto | 'new' | null>(null)
  const [archiving, setArchiving] = useState<VendorContractDto | null>(null)
  const saved = (rows: VendorContractDto[]) => {
    qc.setQueryData(buyKeys.contracts(vendor.id), rows)
    void qc.invalidateQueries({ queryKey: buyKeys.vendor(vendor.id) })
  }

  return (
    <Panel className="content-start">
      <PanelHeader className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle>{t('contracts.title')}</PanelTitle>
        {vendor.can.edit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('contracts.add')}
          </Button>
        )}
      </PanelHeader>
      {query.isPending ? (
        <PanelBody>
          <Skeleton className="h-16 w-full" />
        </PanelBody>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : query.data.length === 0 ? (
        <PanelBody>
          <p className="text-13 text-muted-foreground">{t('contracts.empty')}</p>
        </PanelBody>
      ) : (
        <ul className="divide-y">
          {query.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {c.title}
                  {c.contractNumber && (
                    <span className="font-normal text-muted-foreground tabular">
                      {' '}
                      · {c.contractNumber}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.endDate
                    ? t('contracts.period', { start: day(c.startDate), end: day(c.endDate) })
                    : t('contracts.from', { start: day(c.startDate) })}
                  {c.restaurant && ` · ${c.restaurant.name}`}
                  {c.responseHours !== null &&
                    ` · ${t('contracts.responseShort', { value: c.responseHours })}`}
                </span>
              </span>
              {c.value !== null && (
                <span className="text-sm tabular">{formatCurrency(c.value)}</span>
              )}
              <Badge tone={STATE_TONE[c.state]}>{t(`contracts.state_${c.state}`)}</Badge>
              {vendor.can.edit && (
                <span className="flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('contracts.edit', { title: c.title })}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('contracts.archive', { title: c.title })}
                    onClick={() => setArchiving(c)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ContractDialog
          vendor={vendor}
          contract={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(rows) => {
            saved(rows)
            setEditing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        tone="destructive"
        title={t('contracts.archiveTitle', { title: archiving?.title ?? '' })}
        description={t('contracts.archiveBody')}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          try {
            saved(await vendorsApi.archiveContract(vendor.id, archiving!.id))
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
/** API schema with "all restaurants" as a select value. */
const contractForm = vendorContractSchema.safeExtend({
  restaurantId: z.string().min(1, 'validation.selectOption'),
})

function ContractDialog({
  vendor,
  contract,
  onClose,
  onSaved,
}: {
  vendor: VendorDetail
  contract: VendorContractDto | null
  onClose: () => void
  onSaved: (rows: VendorContractDto[]) => void
}) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const restaurants = useRestaurants()
  const choices = (restaurants.data ?? []).filter(
    (r) => vendor.restaurants.length === 0 || vendor.restaurants.some((x) => x.id === r.id),
  )
  const canAll = user.isSuperAdmin || vendor.can.edit
  const form = useZodForm(contractForm, {
    defaultValues: contract
      ? {
          title: contract.title,
          contractNumber: contract.contractNumber ?? '',
          startDate: contract.startDate,
          endDate: contract.endDate ?? '',
          value: contract.value ?? undefined,
          responseHours: contract.responseHours ?? undefined,
          restaurantId: contract.restaurant?.id ?? ALL,
          terms: contract.terms ?? '',
        }
      : {
          title: '',
          contractNumber: '',
          startDate: new Date().toISOString().slice(0, 10),
          endDate: '',
          value: undefined,
          responseHours: undefined,
          restaurantId: choices.length === 1 ? choices[0]!.id : canAll ? ALL : '',
          terms: '',
        },
  })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const input = { ...v, restaurantId: v.restaurantId === ALL ? '' : v.restaurantId }
      const rows = contract
        ? await vendorsApi.updateContract(vendor.id, contract.id, input)
        : await vendorsApi.addContract(vendor.id, input)
      toast.success(t('contracts.saved'))
      onSaved(rows)
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('root', { message: describeError(err, t) })
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contract ? t('contracts.editTitle') : t('contracts.add')}</DialogTitle>
          <DialogDescription>{vendor.name}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <FormRootError message={errors.root?.message} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="title"
                label={t('contracts.name')}
                placeholder={t('contracts.namePlaceholder')}
                required
              />
              <TextField
                control={form.control}
                name="contractNumber"
                label={t('contracts.number')}
                optional
              />
              <DateField
                control={form.control}
                name="startDate"
                label={t('contracts.start')}
                required
              />
              <DateField
                control={form.control}
                name="endDate"
                label={t('contracts.end')}
                optional
              />
              <NumberField
                control={form.control}
                name="value"
                label={t('contracts.value')}
                optional
                min={0}
                step={0.01}
                suffix="₹"
              />
              <NumberField
                control={form.control}
                name="responseHours"
                label={t('contracts.response')}
                description={t('contracts.responseHint')}
                optional
                min={1}
                step={1}
                suffix="h"
              />
            </div>
            <SelectField
              control={form.control}
              name="restaurantId"
              label={t('wo.fieldRestaurant')}
              placeholder={t('validation.selectOption')}
              options={[
                ...(canAll ? [{ value: ALL, label: t('contracts.allRestaurants') }] : []),
                ...choices.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
            <TextareaField
              control={form.control}
              name="terms"
              label={t('contracts.terms')}
              optional
              rows={3}
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
