import {
  fullName,
  type CalendarForecast,
  type CalendarItem,
  type CalendarWorkOrder,
  type Priority,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { AlarmClock, ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterSelect } from '@/components/tables'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { ViewSwitch } from '@/components/ui/view-switch'
import { useScopedRestaurantParam } from '@/hooks/useScopeFilter'
import { useRestaurants, useTeams, useUserOptions } from '@/hooks/useAdminQueries'
import { useCalendar, workKeys, workOrdersApi } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatTime, intlLocale } from '@/utils/format'

/*
 * Maintenance calendar. Month / week / day views; jobs sit at their planned
 * start (or due date); preventive jobs not generated yet show as "planned".
 * Drag a job to another day (or hour, in the day view) to reschedule it.
 * Week and day views can be split into lanes per technician, team or restaurant.
 */

type View = 'month' | 'week' | 'day'
type GroupBy = 'none' | 'technician' | 'team' | 'restaurant'
const VIEWS: readonly View[] = ['month', 'week', 'day']
const GROUPS: readonly GroupBy[] = ['none', 'technician', 'team', 'restaurant']
const DAY_START = 6
const DAY_END = 22

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** Weeks start on Monday. */
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

function rangeFor(view: View, anchor: Date): Date[] {
  if (view === 'day') return [anchor]
  if (view === 'week') {
    const s = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(s, i))
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const s = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(s, i))
}

const itemDate = (i: CalendarItem) => (i.kind === 'forecast' ? i.date : keyOf(new Date(i.at)))

const PRIORITY_BAR: Record<Priority, string> = {
  LOW: 'border-l-muted-foreground/40',
  MEDIUM: 'border-l-info',
  HIGH: 'border-l-warning',
  CRITICAL: 'border-l-danger',
}

function laneOf(i: CalendarItem, by: GroupBy): { key: string; label: string | null } {
  if (by === 'technician')
    return i.assignedUser
      ? { key: i.assignedUser.id, label: fullName(i.assignedUser) }
      : { key: '—', label: null }
  if (by === 'team')
    return i.assignedTeam
      ? { key: i.assignedTeam.id, label: i.assignedTeam.name }
      : { key: '—', label: null }
  if (by === 'restaurant') return { key: i.restaurant.id, label: i.restaurant.name }
  return { key: 'all', label: null }
}

export function CalendarPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '')
    ? (params.get('view') as View)
    : 'week'
  const groupBy = (GROUPS as readonly string[]).includes(params.get('group') ?? '')
    ? (params.get('group') as GroupBy)
    : 'none'
  // A hand-edited or stale ?date= falls back to today instead of breaking the page.
  const rawDate = params.get('date')
  const anchorKey =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(parseKey(rawDate).getTime())
      ? rawDate
      : keyOf(new Date())
  const anchor = useMemo(() => parseKey(anchorKey), [anchorKey])
  const [restaurantId, setRestaurantId] = useScopedRestaurantParam()
  const assignedUserId = params.get('assignedUserId') ?? undefined
  const teamId = params.get('teamId') ?? undefined

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  const days = useMemo(() => rangeFor(view, anchor), [view, anchor])
  const query = useCalendar({
    from: keyOf(days[0]!),
    to: keyOf(days[days.length - 1]!),
    restaurantId,
    assignedUserId,
    teamId,
  })
  const restaurants = useRestaurants()
  const people = useUserOptions(restaurantId, true, 'work_orders:complete')
  const teams = useTeams()
  const [moving, setMoving] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const i of query.data ?? []) {
      const k = itemDate(i)
      m.set(k, [...(m.get(k) ?? []), i])
    }
    for (const list of m.values())
      list.sort(
        (a, b) =>
          (a.kind === 'forecast' ? 1 : 0) - (b.kind === 'forecast' ? 1 : 0) ||
          itemTime(a) - itemTime(b),
      )
    return m
  }, [query.data])

  /** Moves a job to `day`, keeping its time of day, or to `hour` when given. */
  async function drop(id: string, day: Date, hour?: number) {
    const item = (query.data ?? []).find((i) => i.kind === 'work_order' && i.id === id) as
      CalendarWorkOrder | undefined
    if (!item || !item.canReschedule) return
    const old = new Date(item.at)
    const target = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour ?? old.getHours(),
      hour === undefined ? old.getMinutes() : 0,
    )
    if (target.getTime() === old.getTime()) return
    setMoving(id)
    try {
      await workOrdersApi.reschedule(id, { scheduledStart: target.toISOString() })
      toast.success(t('calendar.moved', { code: item.code }))
      await qc.invalidateQueries({ queryKey: workKeys.workOrders })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) {
      reportError(err, t)
    } finally {
      setMoving(null)
    }
  }

  const step = view === 'month' ? 'month' : view === 'week' ? 7 : 1
  const shift = (dir: 1 | -1) =>
    set({
      date: keyOf(
        step === 'month'
          ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
          : addDays(anchor, dir * step),
      ),
    })
  const title =
    view === 'month'
      ? new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(anchor)
      : view === 'week'
        ? `${fmtDay(days[0]!)} – ${fmtDay(days[6]!)}`
        : new Intl.DateTimeFormat(intlLocale(), {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(anchor)

  return (
    <>
      <PageHeader title={t('calendar.title')} description={t('calendar.subtitle')} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('calendar.previous')}
            onClick={() => shift(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button variant="secondary" onClick={() => set({ date: undefined })}>
            {t('calendar.today')}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('calendar.next')}
            onClick={() => shift(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <h2 className="min-w-48 text-base font-semibold" aria-live="polite">
          {title}
        </h2>
        <span className="flex-1" />
        <ViewSwitch
          label={t('calendar.view')}
          value={view}
          onValueChange={(v) => set({ view: v === 'week' ? undefined : v })}
          options={VIEWS.map((v) => ({ value: v, label: t(`calendar.view_${v}`) }))}
        />
      </div>
      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('calendar.filters')}
      >
        {(restaurants.data?.length ?? 0) > 1 && (
          <FilterSelect
            label={t('wo.colRestaurant')}
            value={restaurantId}
            onChange={setRestaurantId}
            options={(restaurants.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        )}
        <FilterSelect
          label={t('calendar.technician')}
          value={assignedUserId}
          onChange={(v) => set({ assignedUserId: v })}
          options={(people.data ?? []).map((u) => ({
            value: u.id,
            label: `${u.firstName} ${u.lastName}`,
          }))}
        />
        <FilterSelect
          label={t('calendar.team')}
          value={teamId}
          onChange={(v) => set({ teamId: v })}
          options={(teams.data ?? []).map((tm) => ({ value: tm.id, label: tm.name }))}
        />
        {view !== 'month' && (
          <FilterSelect
            label={t('calendar.groupBy')}
            value={groupBy === 'none' ? undefined : groupBy}
            onChange={(v) => set({ group: v })}
            options={GROUPS.filter((g) => g !== 'none').map((g) => ({
              value: g,
              label: t(`calendar.group_${g}`),
            }))}
          />
        )}
        <Legend />
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton className="h-[480px] w-full" />
      ) : view === 'month' ? (
        <MonthGrid
          days={days}
          anchor={anchor}
          byDay={byDay}
          moving={moving}
          onDrop={drop}
          onOpenDay={(d) => set({ view: 'day', date: keyOf(d) })}
        />
      ) : view === 'week' ? (
        <WeekGrid days={days} byDay={byDay} groupBy={groupBy} moving={moving} onDrop={drop} />
      ) : (
        <DayGrid
          day={days[0]!}
          items={byDay.get(keyOf(days[0]!)) ?? []}
          groupBy={groupBy}
          moving={moving}
          onDrop={drop}
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('calendar.dragHint')}</p>
    </>
  )
}

const itemTime = (i: CalendarItem) => (i.kind === 'forecast' ? 0 : new Date(i.at).getTime())
const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' }).format(d)

function Legend() {
  const { t } = useTranslation()
  return (
    <ul className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => (
        <li key={p} className="flex items-center gap-1">
          <span className={cn('h-3 w-1 rounded-sm border-l-4', PRIORITY_BAR[p])} aria-hidden />
          {t(`enums.priority.${p}`)}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <Repeat className="size-3" aria-hidden /> {t('calendar.forecast')}
      </li>
    </ul>
  )
}

/** Drop target: a day cell (and optionally an hour). */
function DropZone({
  onDrop,
  className,
  children,
  label,
}: {
  onDrop: (id: string) => void
  className?: string
  children: ReactNode
  label?: string
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      role="group"
      aria-label={label?.trim() || undefined}
      className={cn(className, over && 'bg-info-soft/60 ring-2 ring-info/50 ring-inset')}
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-work-order')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        setOver(false)
        const id = e.dataTransfer.getData('application/x-work-order')
        if (id) {
          e.preventDefault()
          onDrop(id)
        }
      }}
    >
      {children}
    </div>
  )
}

function Chip({
  item,
  moving,
  compact = false,
}: {
  item: CalendarItem
  moving: string | null
  compact?: boolean
}) {
  const { t } = useTranslation()
  if (item.kind === 'forecast') return <ForecastChip item={item} compact={compact} />
  const who = item.assignedUser ? fullName(item.assignedUser) : item.assignedTeam?.name
  return (
    <Link
      to={`/work-orders/${item.id}`}
      draggable={item.canReschedule}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-work-order', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      title={`${item.code} · ${item.title}${who ? ` · ${who}` : ''}`}
      className={cn(
        'block rounded-md border border-l-4 bg-card px-1.5 py-1 text-xs shadow-card transition-opacity hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring',
        PRIORITY_BAR[item.priority],
        item.canReschedule && 'cursor-grab active:cursor-grabbing',
        moving === item.id && 'opacity-50',
        (item.status === 'CLOSED' || item.status === 'VERIFIED' || item.status === 'REVIEW') &&
          'opacity-70',
      )}
    >
      <span className="flex items-center gap-1">
        {item.overdue && (
          <AlarmClock className="size-3 shrink-0 text-danger-fg" aria-label={t('wo.overdue')} />
        )}
        {item.scheduledStart && (
          <span className="shrink-0 tabular text-muted-foreground">{formatTime(item.at)}</span>
        )}
        <span className="truncate font-medium">{item.title}</span>
      </span>
      {!compact && (
        <span className="mt-0.5 block truncate text-muted-foreground">
          {item.code}
          {who && ` · ${who}`}
          {` · ${t(`enums.workOrderStatus.${item.status}`)}`}
        </span>
      )}
    </Link>
  )
}

function ForecastChip({ item, compact }: { item: CalendarForecast; compact: boolean }) {
  const { t } = useTranslation()
  return (
    <Link
      to={`/maintenance/${item.scheduleId}`}
      title={`${t('calendar.forecast')}: ${item.name}`}
      className={cn(
        'block rounded-md border border-dashed border-l-4 bg-muted/30 px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60',
        PRIORITY_BAR[item.priority],
      )}
    >
      <span className="flex items-center gap-1">
        <Repeat className="size-3 shrink-0" aria-label={t('calendar.forecast')} />
        <span className="truncate">{item.name}</span>
      </span>
      {!compact && item.asset && <span className="block truncate">{item.asset.name}</span>}
    </Link>
  )
}

function DayHeader({ d }: { d: Date }) {
  const today = keyOf(d) === keyOf(new Date())
  return (
    <span className="flex items-baseline gap-1 text-xs">
      <span className="text-muted-foreground">
        {new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d)}
      </span>
      <span
        className={cn(
          'font-semibold tabular',
          today &&
            'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground',
        )}
      >
        {d.getDate()}
      </span>
    </span>
  )
}

function MonthGrid({
  days,
  anchor,
  byDay,
  moving,
  onDrop,
  onOpenDay,
}: {
  days: Date[]
  anchor: Date
  byDay: Map<string, CalendarItem[]>
  moving: string | null
  onDrop: (id: string, day: Date) => void
  onOpenDay: (d: Date) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
      <div className="grid min-w-[760px] grid-cols-7">
        {days.map((d) => {
          const items = byDay.get(keyOf(d)) ?? []
          const outside = d.getMonth() !== anchor.getMonth()
          return (
            <DropZone
              key={keyOf(d)}
              onDrop={(id) => onDrop(id, d)}
              label={keyOf(d)}
              className={cn(
                'min-h-28 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0',
                outside && 'bg-muted/30',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(d)}
                className="mb-1 rounded px-1 hover:bg-muted"
                aria-label={t('calendar.openDay', { date: keyOf(d) })}
              >
                <DayHeader d={d} />
              </button>
              <div className="grid gap-1">
                {items.slice(0, 3).map((i) => (
                  <Chip key={i.id} item={i} moving={moving} compact />
                ))}
                {items.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onOpenDay(d)}
                    className="text-left text-xs font-medium text-primary hover:underline"
                  >
                    {t('calendar.more', { count: items.length - 3 })}
                  </button>
                )}
              </div>
            </DropZone>
          )
        })}
      </div>
    </div>
  )
}

function WeekGrid({
  days,
  byDay,
  groupBy,
  moving,
  onDrop,
}: {
  days: Date[]
  byDay: Map<string, CalendarItem[]>
  groupBy: GroupBy
  moving: string | null
  onDrop: (id: string, day: Date) => void
}) {
  const { t } = useTranslation()
  const all = days.flatMap((d) => byDay.get(keyOf(d)) ?? [])
  const lanes = lanesFor(all, groupBy, t('calendar.unassigned'))
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
      <div
        className="grid min-w-[880px]"
        style={{
          gridTemplateColumns: `${groupBy === 'none' ? '' : '10rem '}repeat(7, minmax(0, 1fr))`,
        }}
      >
        {groupBy !== 'none' && <div className="border-r border-b bg-muted/40" />}
        {days.map((d) => (
          <div key={keyOf(d)} className="border-r border-b bg-muted/40 px-2 py-1.5 last:border-r-0">
            <DayHeader d={d} />
          </div>
        ))}
        {lanes.map((lane) => (
          <LaneRow
            key={lane.key}
            lane={lane}
            days={days}
            byDay={byDay}
            groupBy={groupBy}
            moving={moving}
            onDrop={onDrop}
          />
        ))}
      </div>
    </div>
  )
}

function LaneRow({
  lane,
  days,
  byDay,
  groupBy,
  moving,
  onDrop,
}: {
  lane: { key: string; label: string }
  days: Date[]
  byDay: Map<string, CalendarItem[]>
  groupBy: GroupBy
  moving: string | null
  onDrop: (id: string, day: Date) => void
}) {
  return (
    <>
      {groupBy !== 'none' && (
        <div className="truncate border-r border-b px-2 py-2 text-13 font-medium">{lane.label}</div>
      )}
      {days.map((d) => {
        const items = (byDay.get(keyOf(d)) ?? []).filter(
          (i) => groupBy === 'none' || laneOf(i, groupBy).key === lane.key,
        )
        return (
          <DropZone
            key={keyOf(d)}
            onDrop={(id) => onDrop(id, d)}
            label={`${lane.label} ${keyOf(d)}`}
            className="min-h-32 border-r border-b p-1.5 last:border-r-0"
          >
            <div className="grid gap-1">
              {items.map((i) => (
                <Chip key={i.id} item={i} moving={moving} />
              ))}
            </div>
          </DropZone>
        )
      })}
    </>
  )
}

function lanesFor(items: CalendarItem[], groupBy: GroupBy, unassigned: string) {
  if (groupBy === 'none') return [{ key: 'all', label: '' }]
  const map = new Map<string, string>()
  for (const i of items) {
    const l = laneOf(i, groupBy)
    map.set(l.key, l.label ?? unassigned)
  }
  if (map.size === 0) map.set('—', unassigned)
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => (a.key === '—' ? 1 : b.key === '—' ? -1 : a.label.localeCompare(b.label)))
}

function DayGrid({
  day,
  items,
  groupBy,
  moving,
  onDrop,
}: {
  day: Date
  items: CalendarItem[]
  groupBy: GroupBy
  moving: string | null
  onDrop: (id: string, day: Date, hour?: number) => void
}) {
  const { t } = useTranslation()
  const lanes = lanesFor(items, groupBy, t('calendar.unassigned'))
  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i)
  const hourOf = (i: CalendarItem) => {
    if (i.kind === 'forecast' || (i.kind === 'work_order' && !i.scheduledStart)) return null
    const h = new Date(i.at).getHours()
    return Math.min(DAY_END, Math.max(DAY_START, h))
  }
  const unplanned = items.filter((i) => hourOf(i) === null)
  return (
    <div className="grid gap-3">
      {unplanned.length > 0 && (
        <div className="rounded-xl border bg-card p-3 shadow-card">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('calendar.allDay')}
          </p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {unplanned.map((i) => (
              <Chip key={i.id} item={i} moving={moving} />
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `4rem repeat(${lanes.length}, minmax(12rem, 1fr))`,
            minWidth: `${4 + lanes.length * 12}rem`,
          }}
        >
          <div className="border-r border-b bg-muted/40" />
          {lanes.map((l) => (
            <div
              key={l.key}
              className="truncate border-r border-b bg-muted/40 px-2 py-1.5 text-13 font-medium last:border-r-0"
            >
              {groupBy === 'none' ? t('calendar.jobs') : l.label}
            </div>
          ))}
          {hours.map((h) => (
            <HourRow
              key={h}
              hour={h}
              day={day}
              lanes={lanes}
              groupBy={groupBy}
              items={items.filter((i) => hourOf(i) === h)}
              moving={moving}
              onDrop={onDrop}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function HourRow({
  hour,
  day,
  lanes,
  groupBy,
  items,
  moving,
  onDrop,
}: {
  hour: number
  day: Date
  lanes: Array<{ key: string; label: string }>
  groupBy: GroupBy
  items: CalendarItem[]
  moving: string | null
  onDrop: (id: string, day: Date, hour?: number) => void
}) {
  return (
    <>
      <div className="border-r border-b px-2 py-1 text-right text-xs text-muted-foreground tabular">{`${pad(hour)}:00`}</div>
      {lanes.map((l) => (
        <DropZone
          key={l.key}
          onDrop={(id) => onDrop(id, day, hour)}
          label={`${l.label} ${pad(hour)}:00`}
          className="min-h-12 border-r border-b p-1 last:border-r-0"
        >
          <div className="grid gap-1">
            {items
              .filter((i) => groupBy === 'none' || laneOf(i, groupBy).key === l.key)
              .map((i) => (
                <Chip key={i.id} item={i} moving={moving} />
              ))}
          </div>
        </DropZone>
      ))}
    </>
  )
}
