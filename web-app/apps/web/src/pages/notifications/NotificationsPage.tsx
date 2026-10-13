import { useQueryClient } from '@tanstack/react-query'
import { BellOff, CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { NotificationList } from '@/components/notifications/NotificationList'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewSwitch } from '@/components/ui/view-switch'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { notificationsApi, platformKeys, useNotifications } from '@/services/platform.service'

const PAGE = 30

function Inbox({ large = false }: { large?: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [pages, setPages] = useState(1)
  const query = useNotifications({
    pageSize: PAGE * pages,
    unread: filter === 'unread' ? '1' : undefined,
  })
  const data = query.data

  async function readAll() {
    await notificationsApi.readAll()
    await qc.invalidateQueries({ queryKey: platformKeys.notifications })
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewSwitch
          label={t('notifications.title')}
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: t('notifications.all') },
            { value: 'unread', label: t('notifications.unreadTab', { count: data?.unread ?? 0 }) },
          ]}
        />
        {(data?.unread ?? 0) > 0 && (
          <Button variant="secondary" size={large ? 'lg' : 'sm'} onClick={() => void readAll()}>
            <CheckCheck aria-hidden /> {t('notifications.markAllRead')}
          </Button>
        )}
      </div>
      <Panel className="overflow-hidden">
        {query.isPending ? (
          <div className="grid gap-2 p-4" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : data!.data.length === 0 ? (
          <EmptyState
            compact
            icon={BellOff}
            title={filter === 'unread' ? t('notifications.noneUnread') : t('notifications.empty')}
            description={t('notifications.emptyBody')}
          />
        ) : (
          <NotificationList items={data!.data} large={large} />
        )}
      </Panel>
      {data && data.meta.total > data.data.length && (
        <Button
          variant="secondary"
          className="justify-self-center"
          onClick={() => setPages((p) => p + 1)}
        >
          {t('worker.loadMore')}
        </Button>
      )}
    </div>
  )
}

export function NotificationsPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('notifications.title')} description={t('notifications.subtitle')} />
      <Inbox />
    </>
  )
}

export function WorkerNotificationsPage() {
  const { t } = useTranslation()
  return (
    <>
      <WorkerPageHeader title={t('notifications.title')} />
      <div className="px-4 py-4">
        <Inbox large />
      </div>
    </>
  )
}
