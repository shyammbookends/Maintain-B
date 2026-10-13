import {
  REQUEST_SORT_FIELDS,
  REQUEST_STATUS,
  fullName,
  type RequestDetail,
  type RequestListItem,
} from '@maintainx/shared'
import { createColumnHelper } from '@tanstack/react-table'
import { ArrowRightCircle, Camera, Inbox, Package, XCircle, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { DetailList } from '@/components/common/DetailList'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { SavedViews } from '@/components/common/SavedViews'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DataTable, FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { AttachmentGallery } from '@/components/work-orders/Attachments'
import { WorkOrderForm } from '@/components/work-orders/WorkOrderForm'
import { ReasonDialog } from '@/components/work-orders/dialogs'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useScopeRestaurantFilter } from '@/hooks/useScopeFilter'
import { useTableState } from '@/hooks/useTableState'
import { useQueryClient } from '@tanstack/react-query'
import { requestsApi, useRequest, useRequests, workKeys } from '@/services/work-orders.service'
import { formatDateTime, formatRelative } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { reporterName } from '@/utils/people'
import { ListCard as MListCard, MPill as MobilePill } from '@/components/mobile/kit'
import { Camera as MCamera, MapPin as MMapPin } from 'lucide-react'

const FILTERS = ['status', 'restaurantId'] as const
const TABLE_CONFIG = {
  sortFields: REQUEST_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: FILTERS,
} as const
const col = createColumnHelper<RequestListItem>()

export function RequestsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const table = useTableState<(typeof REQUEST_SORT_FIELDS)[number], (typeof FILTERS)[number]>(
    TABLE_CONFIG,
  )
  const restaurants = useRestaurants()
  useScopeRestaurantFilter(table.state.filters.restaurantId, (id) =>
    table.setFilter('restaurantId', id),
  )
  const query = useRequests(table.apiQuery)
  // The open request lives in the URL so notifications can link straight to it.
  const openId = params.get('open')
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('open', id)
    else next.delete('open')
    setParams(next, { replace: !id })
  }

  const columns = [
    col.accessor('title', {
      header: t('requests.colRequest'),
      enableHiding: false,
      cell: ({ row: { original: r } }) => (
        // Title on one line; a quiet second line with code, equipment and photos.
        <div className="w-full py-0.5 lg:w-[max(14rem,26vw)] 2xl:w-[clamp(18rem,28vw,32rem)]">
          <p className="truncate font-medium" title={r.title}>
            {r.title}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
            <span className="shrink-0 tabular">{r.code}</span>
            {r.asset && (
              <span className="inline-flex min-w-0 items-center gap-1" title={r.asset.name}>
                <Package className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{r.asset.name}</span>
              </span>
            )}
            {r.photoCount > 0 && (
              <span
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5"
                title={t('wo.photos')}
              >
                <Camera className="size-3" aria-hidden />
                <span className="tabular">{r.photoCount}</span>
              </span>
            )}
          </p>
        </div>
      ),
    }),
    col.accessor('status', {
      header: t('requests.colStatus'),
      cell: (c) => <StatusBadge kind="requestStatus" value={c.getValue()} />,
    }),
    col.accessor('priority', {
      header: t('wo.colPriority'),
      enableSorting: true,
      cell: (c) => <StatusBadge kind="priority" value={c.getValue()} />,
    }),
    col.accessor((r) => reporterName(t, r), {
      id: 'requestedBy',
      header: t('requests.colReportedBy'),
      meta: { hideBelow: 'md' },
      cell: (c) => (
        <span className="block max-w-40 truncate" title={c.getValue()}>
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor((r) => r.restaurant.name, {
      id: 'restaurant',
      header: t('wo.colRestaurant'),
      meta: { hideBelow: 'xl' },
      cell: (c) => (
        <span className="block max-w-40 truncate 2xl:max-w-48" title={c.getValue()}>
          {c.getValue()}
        </span>
      ),
    }),
    col.accessor('createdAt', {
      header: t('requests.colReported'),
      enableSorting: true,
      meta: { hideBelow: 'md' },
      cell: (c) => (
        <span className="text-13 whitespace-nowrap text-muted-foreground">
          {formatRelative(c.getValue())}
        </span>
      ),
    }),
  ]

  return (
    <>
      <PageHeader
        title={t('requests.title')}
        description={t('requests.subtitle')}
        actions={<SavedViews resource="requests" />}
      />
      <DataTable
        label={t('requests.title')}
        persistKey="requests"
        columns={columns}
        data={query.data?.data}
        getRowId={(r) => r.id}
        total={query.data?.meta.total}
        page={table.state.page}
        pageSize={table.state.pageSize}
        pageSizes={table.pageSizes}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        sort={table.state.sort}
        onSortChange={(s) => table.setSort(s as typeof table.state.sort)}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(r) => setOpen(r.id)}
        renderCard={(r, open) => (
          <MListCard
            onClick={open}
            top={
              <>
                <span className="text-[12.5px] text-[#64748b] tabular-nums">{r.code}</span>
                <span className="flex-1" />
                <StatusBadge kind="requestStatus" value={r.status} />
              </>
            }
            title={r.title}
            lines={[
              <span key="w" className="flex items-center gap-1">
                <MMapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {[r.asset?.name, r.location?.name, r.restaurant.name].filter(Boolean).join(' · ')}
                </span>
              </span>,
            ]}
            bottom={
              <>
                <StatusBadge kind="priority" value={r.priority} />
                {r.photoCount > 0 && (
                  <MobilePill>
                    <MCamera className="size-3" aria-hidden /> {r.photoCount}
                  </MobilePill>
                )}
                <span className="min-w-0 flex-1 truncate text-right text-xs text-[#64748b]">
                  {reporterName(t, r)} · {formatRelative(r.createdAt)}
                </span>
              </>
            }
          />
        )}
        isFiltered={table.isFiltered}
        onClearFilters={table.clearFilters}
        toolbar={
          <>
            <SearchInput
              value={table.state.q}
              onChange={table.setSearch}
              placeholder={t('requests.search')}
            />
            <FilterSelect
              label={t('requests.colStatus')}
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={REQUEST_STATUS.map((s) => ({
                value: s,
                label: enumLabel(t, 'requestStatus', s),
              }))}
            />
            {(restaurants.data?.length ?? 0) > 1 && (
              <FilterSelect
                label={t('wo.colRestaurant')}
                value={table.state.filters.restaurantId}
                onChange={(v) => table.setFilter('restaurantId', v)}
                options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
          </>
        }
        emptyState={
          <EmptyState
            icon={Inbox}
            title={t('requests.emptyTitle')}
            description={t('requests.emptyBody')}
          />
        }
      />

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent aria-describedby={undefined}>
          {openId && <RequestSheet id={openId} onClose={() => setOpen(null)} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function RequestSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const query = useRequest(id)
  const [converting, setConverting] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [approving, setApproving] = useState(false)

  if (query.isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('requests.title')}</SheetTitle>
        </SheetHeader>
        <SheetBody aria-busy="true" className="grid gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </SheetBody>
      </>
    )
  }
  if (query.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('requests.title')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        </SheetBody>
      </>
    )
  }

  const r: RequestDetail = query.data
  if (converting) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t('requests.convertTitle')}</SheetTitle>
          <SheetDescription>{r.code}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <WorkOrderForm
            prefill={{
              title: r.title,
              description: r.description,
              category: r.category,
              priority: r.priority,
              restaurantId: r.restaurant.id,
              locationId: r.location?.id,
              assetId: r.asset?.id,
              requestId: r.id,
            }}
            onCancel={() => setConverting(false)}
            onDone={(w) => {
              onClose()
              navigate(`/work-orders/${w.id}`)
            }}
          />
        </SheetBody>
      </>
    )
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{r.title}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <span className="tabular">{r.code}</span>
          <StatusBadge kind="requestStatus" value={r.status} />
          <StatusBadge kind="priority" value={r.priority} />
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="grid content-start gap-4">
        {r.status === 'REJECTED' && r.rejectionReason && (
          <Callout
            tone="neutral"
            title={t('requests.rejectedBy', { name: r.reviewedBy ? fullName(r.reviewedBy) : '' })}
          >
            {r.rejectionReason}
          </Callout>
        )}
        {r.status === 'APPROVED' && (
          <Callout
            tone="info"
            title={t('requests.approvedBy', { name: r.reviewedBy ? fullName(r.reviewedBy) : '' })}
          >
            {r.reviewNote}
          </Callout>
        )}
        {r.workOrder && (
          <Callout tone="success" title={t('requests.convertedTo', { code: r.workOrder.code })}>
            <Link
              to={`/work-orders/${r.workOrder.id}`}
              className="font-medium text-primary hover:underline"
            >
              {t('requests.openWorkOrder')}
            </Link>
          </Callout>
        )}
        <p className="text-sm whitespace-pre-wrap">{r.description}</p>
        <AttachmentGallery items={r.attachments} className="grid grid-cols-3 gap-2" />
        <DetailList
          items={[
            {
              label: t('requests.colReportedBy'),
              value: r.guest?.phone
                ? `${reporterName(t, r)} · ${r.guest.phone}`
                : reporterName(t, r),
            },
            { label: t('requests.colReported'), value: formatDateTime(r.createdAt) },
            { label: t('wo.fieldCategory'), value: enumLabel(t, 'workOrderCategory', r.category) },
            { label: t('wo.fieldRestaurant'), value: r.restaurant.name },
            { label: t('wo.fieldLocation'), value: r.location?.name },
            {
              label: t('wo.fieldAsset'),
              value: r.asset && (
                <Link to={`/assets/${r.asset.id}`} className="text-primary hover:underline">
                  {r.asset.name} · {r.asset.assetCode}
                </Link>
              ),
            },
          ]}
        />
        {(r.can.convert || r.can.reject || r.can.approve) && (
          <div className="flex flex-wrap gap-2">
            {r.can.approve && (
              <Button variant="secondary" onClick={() => setApproving(true)}>
                <ThumbsUp aria-hidden /> {t('requests.approve')}
              </Button>
            )}
            {r.can.convert && (
              <Button onClick={() => setConverting(true)}>
                <ArrowRightCircle aria-hidden /> {t('requests.convert')}
              </Button>
            )}
            {r.can.reject && (
              <Button variant="destructive-outline" onClick={() => setRejecting(true)}>
                <XCircle aria-hidden /> {t('requests.reject')}
              </Button>
            )}
          </div>
        )}
      </SheetBody>
      <ReasonDialog
        open={approving}
        onOpenChange={setApproving}
        title={t('requests.approveTitle')}
        description={t('requests.approveBody')}
        label={t('requests.approveNote')}
        confirmLabel={t('requests.approve')}
        minLength={0}
        onSubmit={async (note) => {
          const updated = await requestsApi.approve(r.id, { note })
          qc.setQueryData(workKeys.request(r.id), updated)
          await qc.invalidateQueries({ queryKey: ['requests', 'list'] })
          // The dashboard counts open requests.
          void qc.invalidateQueries({ queryKey: ['dashboard'] })
          toast.success(t('requests.approved'))
        }}
      />
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('requests.rejectTitle')}
        description={t('requests.rejectBody')}
        label={t('requests.rejectReason')}
        confirmLabel={t('requests.reject')}
        tone="destructive"
        onSubmit={async (reason) => {
          const updated = await requestsApi.reject(r.id, { reason })
          qc.setQueryData(workKeys.request(r.id), updated)
          await qc.invalidateQueries({ queryKey: ['requests', 'list'] })
          // The dashboard counts open requests.
          void qc.invalidateQueries({ queryKey: ['dashboard'] })
          toast.success(t('requests.rejected'))
        }}
      />
    </>
  )
}
