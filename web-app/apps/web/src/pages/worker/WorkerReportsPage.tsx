import { Inbox, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useRequests } from '@/services/work-orders.service'
import { formatRelative } from '@/utils/format'
import { TaskListSkeleton } from './WorkerTaskList'

/** Problems I reported and what happened to them. */
export function WorkerReportsPage() {
  const { t } = useTranslation()
  const query = useRequests({ mine: '1', pageSize: 50 })

  return (
    <>
      <WorkerPageHeader
        title={t('report.mine')}
        backTo="/w/more"
        actions={
          <Button asChild size="sm">
            <Link to="/w/report">
              <Plus aria-hidden /> {t('report.new')}
            </Link>
          </Button>
        }
      />
      <div className="px-4 py-4">
        {query.isPending ? (
          <TaskListSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.data.data.length === 0 ? (
          <div className="rounded-lg border">
            <EmptyState
              compact
              icon={Inbox}
              title={t('report.noneTitle')}
              description={t('report.noneBody')}
            />
          </div>
        ) : (
          <ul className="grid gap-2">
            {query.data.data.map((r) => (
              <li key={r.id} className="grid gap-1 rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground tabular">{r.code}</span>
                  <StatusBadge kind="requestStatus" value={r.status} />
                </div>
                <p className="line-clamp-2 text-base leading-snug font-medium">{r.title}</p>
                <p className="truncate text-13 text-muted-foreground">
                  {[r.asset?.name, r.restaurant.name].filter(Boolean).join(' · ')} ·{' '}
                  {formatRelative(r.createdAt)}
                </p>
                {r.status === 'CONVERTED' && (
                  <p className="text-13 text-success-fg">{t('report.beingFixed')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
