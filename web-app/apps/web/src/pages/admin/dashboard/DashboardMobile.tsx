import { fullName, type DashboardSummary, type DashboardWorkOrder } from '@maintainx/shared'
import {
  AlarmClock,
  BarChart3,
  CheckCheck,
  ClipboardList,
  Clock,
  Inbox,
  IndianRupee,
  Package,
  PackageX,
  PlusCircle,
  PowerOff,
  ShieldCheck,
  Store,
  ThumbsUp,
  Timer,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import {
  AppCard,
  BrandHero,
  CardList,
  IconChip,
  MAvatar,
  MPill,
  Metric,
  SectionTitle,
  StatGrid,
  StatTile,
  type HeroAction,
} from '@/components/mobile/kit'
import { initialsOf } from '@/components/mobile/tones'
import { MTaskCard } from '@/components/mobile/MTaskCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { formatCurrency, formatNumber } from '@/utils/format'

/*
 * The phone dashboard: the Flutter app's DashboardScreen
 * (mobile-app/lib/screens/admin/admin_shell.dart). Same data as the desktop page.
 */

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

const COST_COLORS = {
  parts: '#0ea5e9',
  labour: '#10b981',
  vendor: '#7c3aed',
  other: '#f59e0b',
} as const

function CostCard({ cost }: { cost: DashboardSummary['cost'] }) {
  const { t } = useTranslation()
  const parts = (['parts', 'labour', 'vendor', 'other'] as const).map((k) => ({
    k,
    value: cost[k],
    label: t(`wo.cost${k[0]!.toUpperCase()}${k.slice(1)}` as 'wo.costParts'),
  }))
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <AppCard>
      <div className="flex items-center gap-2.5">
        <IconChip icon={IndianRupee} tone="success" size={34} />
        <h2 className="min-w-0 flex-1 text-[14.5px] font-semibold">{t('dashboard.cost')}</h2>
        <span className="text-xl font-bold tabular-nums">{formatCurrency(cost.total)}</span>
      </div>
      {total > 0 && (
        <div className="mt-5">
          <div className="flex h-2.5 overflow-hidden rounded-md" aria-hidden>
            {parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <span
                  key={p.k}
                  style={{ flexGrow: p.value / total, background: COST_COLORS[p.k] }}
                />
              ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {parts.map((p) => (
              <li key={p.k} className="flex items-center gap-1 text-xs text-[#64748b]">
                <span
                  aria-hidden
                  className="size-2.5 rounded-[3px]"
                  style={{ background: COST_COLORS[p.k] }}
                />
                {p.label} {formatCurrency(p.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppCard>
  )
}

function WoCards({ items, overdue }: { items: DashboardWorkOrder[]; overdue?: boolean }) {
  return (
    <CardList>
      {items.map((w) => (
        <li key={w.id} className="min-w-0">
          <MTaskCard
            to={`/work-orders/${w.id}`}
            code={w.code}
            title={w.title}
            where={[w.restaurant.name]}
            priority={w.priority}
            status={w.status}
            dueDate={w.dueDate}
            overdue={overdue}
            assignee={
              w.assignee ? { initials: initialsOf(w.assignee), name: fullName(w.assignee) } : null
            }
          />
        </li>
      ))}
    </CardList>
  )
}

function Body({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const c = data.counts
  const nothingToDo =
    data.criticalIssues.length === 0 &&
    data.overdueTasks.length === 0 &&
    data.todaysTasks.length === 0
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
  return (
    <>
      <StatGrid>
        <StatTile
          label={t('dashboard.kpiOpen')}
          value={formatNumber(c.open)}
          icon={ClipboardList}
          tone="info"
          to="/work-orders?view=active"
        />
        <StatTile
          label={t('dashboard.kpiOverdue')}
          value={formatNumber(c.overdue)}
          icon={AlarmClock}
          tone="danger"
          alert={c.overdue > 0}
          to="/work-orders?view=overdue"
        />
        <StatTile
          label={t('dashboard.kpiInProgress')}
          value={formatNumber(c.inProgress)}
          icon={Timer}
          tone="warning"
          to="/work-orders?status=IN_PROGRESS"
        />
        <StatTile
          label={t('dashboard.kpiVerify')}
          value={formatNumber(c.pendingVerification)}
          icon={ThumbsUp}
          tone="violet"
          to="/work-orders?view=review"
        />
        <StatTile
          label={t('dashboard.kpiCompleted30')}
          value={formatNumber(c.completed30d)}
          icon={CheckCheck}
          tone="success"
          to="/work-orders?view=done"
        />
        <StatTile
          label={t('dashboard.statRequests')}
          value={formatNumber(c.openRequests)}
          icon={Inbox}
          tone="sky"
          to="/requests"
        />
        <StatTile
          label={t('dashboard.kpiAssetsDown')}
          value={formatNumber(c.assetsDown)}
          icon={PackageX}
          tone="danger"
          alert={c.assetsDown > 0}
          to="/assets?status=BROKEN"
        />
        <StatTile
          label={t('dashboard.kpiLowStock')}
          value={formatNumber(c.lowStock)}
          icon={Package}
          tone="warning"
          to="/inventory?low=1"
        />
      </StatGrid>

      <div className="mt-3.5">
        <AppCard>
          <div className="flex gap-1">
            <Metric
              label={t('dashboard.kpiPm')}
              value={pct(data.pmCompliance)}
              icon={ShieldCheck}
              tone="success"
            />
            <Metric
              label={t('dashboard.statOnTime')}
              value={pct(data.onTimeRate)}
              icon={Clock}
              tone="info"
            />
            <Metric
              label={t('dashboard.statMttr')}
              value={
                data.mttrHours === null ? '—' : t('dashboard.hours', { value: data.mttrHours })
              }
              icon={Wrench}
              tone="warning"
            />
            <Metric
              label={t('dashboard.statDowntime')}
              value={t('dashboard.hours', { value: data.downtimeHours })}
              icon={PowerOff}
              tone="danger"
            />
          </div>
        </AppCard>
      </div>

      {can('reports:view') && (
        <Link
          to="/analytics"
          className="m-press mt-2.5 flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[#4f46e5] px-4 text-[15px] font-semibold text-white"
        >
          <BarChart3 className="size-5" aria-hidden /> {t('nav.analytics')}
        </Link>
      )}

      <div className="mt-2.5">
        <CostCard cost={data.cost} />
      </div>

      {nothingToDo && (
        <div className="mt-4">
          <AppCard>
            <EmptyState compact icon={CheckCheck} title={t('dashboard.todayEmpty')} />
          </AppCard>
        </div>
      )}
      {data.criticalIssues.length > 0 && (
        <section className="mt-4">
          <SectionTitle>{t('dashboard.critical')}</SectionTitle>
          <WoCards items={data.criticalIssues} />
        </section>
      )}
      {data.overdueTasks.length > 0 && (
        <section className="mt-2">
          <SectionTitle>{t('dashboard.overdue')}</SectionTitle>
          <WoCards items={data.overdueTasks} overdue />
        </section>
      )}
      {data.todaysTasks.length > 0 && (
        <section className="mt-2">
          <SectionTitle>{t('dashboard.today')}</SectionTitle>
          <WoCards items={data.todaysTasks} />
        </section>
      )}

      {data.workload.length > 0 && (
        <section className="mt-2">
          <SectionTitle>{t('dashboard.workload')}</SectionTitle>
          <AppCard padding="py-1">
            <ul>
              {data.workload.map((r, i) => (
                <li key={r.user.id} className="relative">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="absolute top-0 right-4 left-16 h-px bg-[#edf0f6]"
                    />
                  )}
                  <Link
                    to={`/work-orders?assignedUserId=${r.user.id}&view=active`}
                    className="m-press flex min-h-16 items-center gap-4 px-4 py-2"
                  >
                    <MAvatar initials={initialsOf(r.user)} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">
                        {fullName(r.user)}
                      </span>
                      <span className="block truncate text-[13px] text-[#64748b]">
                        {t('dashboard.workloadDetail', {
                          running: r.inProgress,
                          overdue: r.overdue,
                          done: r.completed,
                        })}
                      </span>
                    </span>
                    {r.overdue > 0 && (
                      <MPill tone="danger">
                        {t('dashboard.colOverdue')} {formatNumber(r.overdue)}
                      </MPill>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </AppCard>
        </section>
      )}

      {data.restaurants.length > 1 && (
        <section className="mt-4">
          <SectionTitle>{t('dashboard.byRestaurant')}</SectionTitle>
          <CardList>
            {data.restaurants.map((r) => (
              <li key={r.id} className="min-w-0">
                <AppCard to={`/restaurants/${r.id}`} className="h-full">
                  <span className="flex items-center gap-2.5">
                    <IconChip icon={Store} size={32} />
                    <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
                  </span>
                  <span className="mt-2.5 flex flex-wrap gap-1.5">
                    <MPill tone="info">
                      {t('dashboard.colOpen')} {formatNumber(r.open)}
                    </MPill>
                    {r.overdue > 0 && (
                      <MPill tone="danger">
                        {t('dashboard.colOverdue')} {formatNumber(r.overdue)}
                      </MPill>
                    )}
                    {r.critical > 0 && (
                      <MPill tone="danger">
                        {t('dashboard.colCritical')} {formatNumber(r.critical)}
                      </MPill>
                    )}
                    <MPill tone="success">
                      {t('dashboard.colCompleted')} {formatNumber(r.completed)}
                    </MPill>
                    {r.assetsDown > 0 && (
                      <MPill tone="warning">
                        {t('dashboard.colAssetsDown')} {formatNumber(r.assetsDown)}
                      </MPill>
                    )}
                    <MPill>{formatCurrency(r.cost)}</MPill>
                  </span>
                </AppCard>
              </li>
            ))}
          </CardList>
        </section>
      )}
    </>
  )
}

export function DashboardMobile({
  data,
  isPending,
  error,
  onRetry,
}: {
  data: DashboardSummary | undefined
  isPending: boolean
  error: unknown
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { can } = useAuth()
  const user = useCurrentUser()
  const actions: HeroAction[] = [
    ...(can('work_orders:create')
      ? [{ icon: PlusCircle, label: t('wo.new'), to: '/work-orders?new=1' }]
      : []),
    ...(can('reports:view')
      ? [{ icon: BarChart3, label: t('nav.analytics'), to: '/analytics' }]
      : []),
  ]
  return (
    <div className="grid gap-4">
      <BrandHero
        blue
        overline={user.isSuperAdmin ? t('dashboard.titleSuper') : t('dashboard.title')}
        title={t(greetingKey(new Date().getHours()), { name: user.firstName })}
        subtitle={
          data
            ? t('dashboard.todayLine', {
                created: data.today.newRequests,
                completed: data.today.completed,
                critical: data.today.critical,
              })
            : ' '
        }
        initials={initialsOf(user)}
        actions={actions}
      />
      <div>
        {isPending ? (
          <div className="grid grid-cols-2 gap-3" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[118px] w-full rounded-[20px]" />
            ))}
          </div>
        ) : error || !data ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : (
          <Body data={data} />
        )}
      </div>
    </div>
  )
}
