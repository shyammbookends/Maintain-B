import { DOCUMENT_OWNER_TYPE, DOCUMENT_TYPE } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentRows } from '@/components/documents/DocumentList'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterSelect, SearchInput } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewSwitch } from '@/components/ui/view-switch'
import { useRestaurants } from '@/hooks/useAdminQueries'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { platformKeys, useDocuments } from '@/services/platform.service'
import { enumLabel } from '@/utils/i18n'

const PAGE = 50

/**
 * Every document the user can see: licences, certificates, AMCs, manuals…
 * Uploads happen on the record they belong to (asset, restaurant, vendor).
 */
export function DocumentsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const restaurants = useRestaurants()
  const [expiry, setExpiry] = useState<'all' | 'expiring' | 'expired'>('all')
  const [docType, setDocType] = useState<string | undefined>()
  const [ownerType, setOwnerType] = useState<string | undefined>()
  const [restaurantId, setRestaurantId] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [pages, setPages] = useState(1)
  const search = useDebouncedValue(q, 300)
  const query = useDocuments({
    expiry: expiry === 'all' ? undefined : expiry,
    docType,
    ownerType,
    restaurantId,
    q: search || undefined,
    pageSize: PAGE * pages,
  })

  return (
    <>
      <PageHeader title={t('documents.pageTitle')} description={t('documents.subtitle')} />
      <ViewSwitch
        label={t('documents.pageTitle')}
        value={expiry}
        onValueChange={setExpiry}
        options={[
          { value: 'all', label: t('documents.all') },
          { value: 'expiring', label: t('documents.expiringSoon') },
          { value: 'expired', label: t('documents.expired') },
        ]}
        className="mb-3"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder={t('documents.search')} />
        <FilterSelect
          label={t('documents.type')}
          value={docType}
          onChange={setDocType}
          options={DOCUMENT_TYPE.map((d) => ({ value: d, label: enumLabel(t, 'documentType', d) }))}
        />
        <FilterSelect
          label={t('documents.belongsTo')}
          value={ownerType}
          onChange={setOwnerType}
          options={DOCUMENT_OWNER_TYPE.map((o) => ({ value: o, label: t(`documents.owner_${o}`) }))}
        />
        {(restaurants.data?.length ?? 0) > 1 && (
          <FilterSelect
            label={t('wo.colRestaurant')}
            value={restaurantId}
            onChange={setRestaurantId}
            options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
      </div>
      <Panel className="overflow-hidden">
        {query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.data.length === 0 ? (
          <EmptyState
            compact
            icon={FileText}
            title={t('documents.emptyTitle')}
            description={t('documents.emptyBody')}
          />
        ) : (
          <DocumentRows
            docs={query.data.data}
            showOwner
            onChanged={() => void qc.invalidateQueries({ queryKey: platformKeys.documents })}
          />
        )}
      </Panel>
      {query.data && query.data.meta.total > query.data.data.length && (
        <div className="mt-3 text-center">
          <Button variant="secondary" onClick={() => setPages((p) => p + 1)}>
            {t('worker.loadMore')}
          </Button>
        </div>
      )}
    </>
  )
}
