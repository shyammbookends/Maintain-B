import { fullName, type DashboardSummary, type DashboardWorkOrder } from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Clock,
  Inbox,
  IndianRupee,
  Package,
  PackageX,
  Plus,
  ThumbsUp,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { CostBreakdownView } from '@/components/work-orders/CostPanel'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { DashboardMobile } from './DashboardMobile'
import { dashboardQuery } from '@/services/dashboard.service'
import { cn } from '@/utils/cn'
import { usePhone } from '@/hooks/usePhone'
import {
  DUE_TONE_CLASS,
  describeDue,
  formatCurrency,
  formatNumber,
  formatTime,
} from '@/utils/format'

/*
 * One simple scrolling page, the same as the mobile app's dashboard:
 * hero, key numbers, performance, cost, the lists that need action,
 * technician workload and restaurants. Charts live on /analytics.
 */

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

function useDashboard(restaurantId: string | null) {
  return useQuery(dashboardQuery(restaurantId))
}

// ---------------------------------------------------------------------------

type Tone = 'info' | 'danger' | 'warning' | 'success' | 'review'

const TONE: Record<Tone, string> = {
  info: 'bg-info-soft text-info-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  success: 'bg-success-soft text-success-fg',
  review: 'bg-review-soft text-review-fg',
}

interface StatProps {
  label: string
  value: number
  icon: LucideIcon
  tone: Tone
  /** Shown as icon + text when the number needs action, never colour alone. */
  alert?: string
  to: string
}

function Stat({ label, value, icon: Icon, tone, alert, to }: StatProps) {
  return (
    <li className="min-w-0">
      <Link
        to={to}
        className={cn(
          'card-lift flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-card focus-visible:outline-2 focus-visible:outline-ring',
          alert && 'border-danger/30',
        )}
      >
        <span className={cn('flex size-9 items-center justify-center rounded-lg', TONE[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="text-2xl leading-none font-semibold tracking-tight tabular">
          {formatNumber(value)}
        </span>
        <span className="truncate text-13 text-muted-foreground">{label}</span>
        {alert && (
          <span className="flex items-center gap-1 text-xs font-medium text-danger-fg">
            <AlertTriangle className="size-3" aria-hidden /> {alert}
          </span>
        )}
      </Link>
    </li>
  )
}

function StatGrid({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const c = data.counts
  const attention = (n: number) => (n > 0 ? t('dashboard.needsAttention') : undefined)
  return (
    <ul className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat
        label={t('dashboard.kpiOpen')}
        value={c.open}
        icon={ClipboardList}
        tone="info"
        to="/work-orders?view=active"
      />
      <Stat
        label={t('dashboard.kpiOverdue')}
        value={c.overdue}
        icon={Clock}
        tone="danger"
        alert={attention(c.overdue)}
        to="/work-orders?view=overdue"
      />
      <Stat
        label={t('dashboard.kpiInProgress')}
        value={c.inProgress}
        icon={Timer}
        tone="info"
        to="/work-orders?status=IN_PROGRESS"
      />
      <Stat
        label={t('dashboard.kpiVerify')}
        value={c.pendingVerification}
        icon={ThumbsUp}
        tone="review"
        to="/work-orders?view=review"
      />
      <Stat
        label={t('dashboard.kpiCompleted30')}
        value={c.completed30d}
        icon={CheckCheck}
        tone="success"
        to="/work-orders?view=done"
      />
      <Stat
        label={t('dashboard.statRequests')}
        value={c.openRequests}
        icon={Inbox}
        tone="review"
        to="/requests"
      />
      <Stat
        label={t('dashboard.kpiAssetsDown')}
        value={c.assetsDown}
        icon={PackageX}
        tone="warning"
        alert={attention(c.assetsDown)}
        to="/assets?status=BROKEN"
      />
      <Stat
        label={t('dashboard.kpiLowStock')}
        value={c.lowStock}
        icon={Package}
        tone="warning"
        alert={attention(c.lowStock)}
        to="/inventory?low=1"
      />
    </ul>
  )
}

/** PM compliance, on-time rate, repair time and downtime in one card. */
function Performance({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const metrics: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: t('dashboard.kpiPm'),
      value: data.pmCompliance === null ? '—' : `${data.pmCompliance}%`,
      hint: data.pmCompliance === null ? t('dashboard.kpiPmNone') : undefined,
    },
    {
      label: t('dashboard.statOnTime'),
      value: data.onTimeRate === null ? '—' : `${data.onTimeRate}%`,
    },
    {
      label: t('dashboard.statMttr'),
      value: data.mttrHours === null ? '—' : t('dashboard.hours', { value: data.mttrHours }),
    },
    {
      label: t('dashboard.statDowntime'),
      value: t('dashboard.hours', { value: data.downtimeHours }),
    },
  ]
  return (
    <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 shadow-card sm:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="min-w-0">
          <dt className="truncate text-13 text-muted-foreground">{m.label}</dt>
          <dd className="text-xl font-semibold tabular">{m.value}</dd>
          {m.hint && <dd className="text-xs text-muted-foreground">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </PanelTitle>
      </PanelHeader>
      {children}
    </Panel>
  )
}

function WorkOrderRows({ items }: { items: DashboardWorkOrder[] }) {
  const { t } = useTranslation()
  return (
    <ul className="divide-y">
      {items.map((w) => {
        const due = w.dueDate ? describeDue(w.dueDate, t) : null
        return (
          <li key={w.id} className="relative grid gap-1 px-4 py-2.5 hover:bg-muted/50">
            <div className="flex items-start justify-between gap-3">
              <Link
                to={`/work-orders/${w.id}`}
                className="min-w-0 truncate text-sm font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {w.title}
              </Link>
              <StatusBadge kind="priority" value={w.priority} />
            </div>
            <p className="flex flex-wrap gap-x-2 text-13 text-muted-foreground">
              <span className="tabular">{w.code}</span>
              <span aria-hidden>·</span>
              <span>{w.restaurant.name}</span>
              <span aria-hidden>·</span>
              <span>{w.assignee ? fullName(w.assignee) : t('dashboard.unassigned')}</span>
              {due && (
                <>
                  <span aria-hidden>·</span>
                  <span className={cn('font-medium', DUE_TONE_CLASS[due.tone])}>{due.label}</span>
                </>
              )}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

function Pill({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs tabular',
        alert ? 'bg-danger-soft font-medium text-danger-fg' : 'bg-muted text-muted-foreground',
      )}
    >
      {label} {value}
    </span>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function DashboardBody({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const nothingToDo =
    data.criticalIssues.length === 0 &&
    data.overdueTasks.length === 0 &&
    data.todaysTasks.length === 0
  return (
    <div className="grid gap-4">
      <StatGrid data={data} />
      <Performance data={data} />

      <Section title={t('dashboard.cost')} icon={IndianRupee}>
        <PanelBody>
          <CostBreakdownView cost={data.cost} />
        </PanelBody>
      </Section>

      {nothingToDo && (
        <Panel>
          <EmptyState compact icon={CheckCheck} title={t('dashboard.todayEmpty')} />
        </Panel>
      )}
      {data.criticalIssues.length > 0 && (
        <Section title={t('dashboard.critical')} icon={AlertTriangle}>
          <WorkOrderRows items={data.criticalIssues} />
        </Section>
      )}
      {data.overdueTasks.length > 0 && (
        <Section title={t('dashboard.overdue')} icon={Clock}>
          <WorkOrderRows items={data.overdueTasks} />
        </Section>
      )}
      {data.todaysTasks.length > 0 && (
        <Section title={t('dashboard.today')} icon={CalendarClock}>
          <WorkOrderRows items={data.todaysTasks} />
        </Section>
      )}

      {data.workload.length > 0 && (
        <Section title={t('dashboard.workload')} icon={Users}>
          <ul className="divide-y">
            {data.workload.map((r) => (
              <li key={r.user.id}>
                <Link
                  to={`/work-orders?assignedUserId=${r.user.id}&view=active`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0 truncate font-medium">{fullName(r.user)}</span>
                  <span className="flex shrink-0 gap-1.5">
                    <Pill label={t('dashboard.colOpen')} value={formatNumber(r.open)} />
                    {r.overdue > 0 && (
                      <Pill
                        label={t('dashboard.colOverdue')}
                        value={formatNumber(r.overdue)}
                        alert
                      />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.restaurants.length > 1 && (
        <section aria-labelledby="dash-restaurants" className="grid gap-3">
          <h2 id="dash-restaurants" className="text-base font-semibold">
            {t('dashboard.byRestaurant')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.restaurants.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/restaurants/${r.id}`}
                  className="card-lift grid gap-2 rounded-xl border bg-card p-4 shadow-card"
                >
                  <span className="font-medium">
                    {r.name} <span className="text-13 text-muted-foreground tabular">{r.code}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Pill label={t('dashboard.colOpen')} value={formatNumber(r.open)} />
                    <Pill
                      label={t('dashboard.colOverdue')}
                      value={formatNumber(r.overdue)}
                      alert={r.overdue > 0}
                    />
                    <Pill
                      label={t('dashboard.colCritical')}
                      value={formatNumber(r.critical)}
                      alert={r.critical > 0}
                    />
                    <Pill label={t('dashboard.colCompleted')} value={formatNumber(r.completed)} />
                    <Pill
                      label={t('dashboard.colAssetsDown')}
                      value={formatNumber(r.assetsDown)}
                      alert={r.assetsDown > 0}
                    />
                    <Pill label={t('dashboard.colCost')} value={formatCurrency(r.cost)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const { restaurantId } = useRestaurantScope()
  const query = useDashboard(restaurantId)
  const user = useCurrentUser()
  const data = query.data
  // Phones: the Flutter app's dashboard (same data).
  const phone = usePhone()
  if (phone)
    return (
      <DashboardMobile
        data={data}
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    )

  return (
    <>
      <section className="bg-brand animate-rise relative mb-4 overflow-hidden rounded-2xl px-6 py-6 shadow-[0_12px_32px_-12px_oklch(0.42_0.17_262/0.55)] sm:px-8">
        <span
          aria-hidden
          className="absolute -top-12 -right-12 size-48 rounded-full bg-white/10 blur-2xl"
        />
        <p className="relative text-sm font-medium text-white/85">
          {t(greetingKey(new Date().getHours()), { name: user.firstName })}
        </p>
        <h1 className="relative mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {user.isSuperAdmin ? t('dashboard.titleSuper') : t('dashboard.title')}
        </h1>
        <p className="relative mt-1 text-sm text-white/85">
          {data
            ? t('dashboard.todayLine', {
                created: data.today.newRequests,
                completed: data.today.completed,
                critical: data.today.critical,
              })
            : ' '}
        </p>
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          {can('work_orders:create') && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/work-orders?new=1">
                <Plus aria-hidden /> {t('wo.new')}
              </Link>
            </Button>
          )}
          {can('reports:view') && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="border border-white/40 text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/analytics">
                <BarChart3 aria-hidden /> {t('nav.analytics')}
              </Link>
            </Button>
          )}
          {data && (
            <span className="ml-auto text-xs text-white/75">
              {t('dashboard.updated', { time: formatTime(data.generatedAt) })}
            </span>
          )}
        </div>
      </section>

      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DashboardBody data={query.data} />
      )}
    </>
  )
}
