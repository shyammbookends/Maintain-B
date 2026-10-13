import { notificationLinkFor, type NotificationDto } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlarmClock,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Inbox,
  MessageSquare,
  Package,
  ShieldAlert,
  ShoppingCart,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  Ban,
  CalendarRange,
  PlayCircle,
  PackageCheck,
  FileClock,
  Zap,
  AtSign,
  UserMinus,
  Hourglass,
  RotateCcw,
  Gauge,
  HardDrive,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '@/contexts/AuthContext'
import { notificationsApi, platformKeys } from '@/services/platform.service'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'

const ICONS: Record<NotificationDto['type'], LucideIcon> = {
  NEW_REQUEST: Inbox,
  TASK_ASSIGNED: ClipboardList,
  TASK_OVERDUE: AlarmClock,
  PM_DUE: CalendarClock,
  CRITICAL_ISSUE: AlertTriangle,
  LOW_STOCK: Package,
  PO_APPROVAL: ShoppingCart,
  WARRANTY_EXPIRY: ShieldAlert,
  TASK_COMPLETED: CheckCircle2,
  INSPECTION_FAILED: AlertTriangle,
  NEW_MESSAGE: MessageSquare,
  DOCUMENT_EXPIRY: FileWarning,
  REQUEST_APPROVED: ThumbsUp,
  REQUEST_REJECTED: ThumbsDown,
  WORK_REJECTED: Undo2,
  WORK_CANCELLED: Ban,
  WORK_STARTED: PlayCircle,
  WORK_RESCHEDULED: CalendarRange,
  PO_RECEIVED: PackageCheck,
  CONTRACT_EXPIRY: FileClock,
  AUTOMATION: Zap,
  MENTION: AtSign,
  WORK_REASSIGNED: UserMinus,
  DUE_SOON: Hourglass,
  WORK_REOPENED: RotateCcw,
  METER_ALERT: Gauge,
  STORAGE_ALERT: HardDrive,
  CHAT_MESSAGE: MessagesSquare,
}

type Tone = 'danger' | 'warning' | 'success' | 'info' | 'review'

/** Colour of each kind of alert, so the list can be scanned at a glance. */
const TONES: Record<NotificationDto['type'], Tone> = {
  TASK_OVERDUE: 'danger',
  CRITICAL_ISSUE: 'danger',
  INSPECTION_FAILED: 'danger',
  WORK_REJECTED: 'danger',
  WORK_CANCELLED: 'danger',
  REQUEST_REJECTED: 'danger',
  METER_ALERT: 'danger',
  STORAGE_ALERT: 'danger',
  PM_DUE: 'warning',
  DUE_SOON: 'warning',
  LOW_STOCK: 'warning',
  WARRANTY_EXPIRY: 'warning',
  DOCUMENT_EXPIRY: 'warning',
  CONTRACT_EXPIRY: 'warning',
  WORK_RESCHEDULED: 'warning',
  WORK_REASSIGNED: 'warning',
  WORK_REOPENED: 'warning',
  TASK_COMPLETED: 'success',
  REQUEST_APPROVED: 'success',
  PO_RECEIVED: 'success',
  NEW_REQUEST: 'info',
  TASK_ASSIGNED: 'info',
  WORK_STARTED: 'info',
  PO_APPROVAL: 'info',
  AUTOMATION: 'info',
  NEW_MESSAGE: 'review',
  CHAT_MESSAGE: 'review',
  MENTION: 'review',
}

const TONE_CLASS: Record<Tone, string> = {
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  success: 'bg-success-soft text-success-fg',
  info: 'bg-info-soft text-info-fg',
  review: 'bg-review-soft text-review-fg',
}

/** One list for the bell popover, the admin page and the worker tab. */
export function NotificationList({
  items,
  onNavigate,
  large = false,
}: {
  items: NotificationDto[]
  onNavigate?: () => void
  large?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const isWorker = user?.roleKind === 'WORKER'

  async function open(n: NotificationDto) {
    if (!n.readAt) {
      // Optimistic: the badge drops at once; the server confirms in the background.
      void notificationsApi.read(n.id).finally(() => {
        void qc.invalidateQueries({ queryKey: platformKeys.notifications })
      })
    }
    const to = notificationLinkFor(n.actionUrl, isWorker)
    onNavigate?.()
    if (to) navigate(to)
  }

  return (
    <ul className="divide-y">
      {items.map((n) => {
        const Icon = ICONS[n.type] ?? Bell
        const tone: Tone = n.priority === 'CRITICAL' ? 'danger' : (TONES[n.type] ?? 'info')
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={cn(
                'relative flex w-full items-start gap-3 px-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                large ? 'py-3.5' : 'py-3',
                // Unread: a soft blue row with a blue edge.
                !n.readAt &&
                  'bg-info-soft/50 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary hover:bg-info-soft/80',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  TONE_CLASS[tone],
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('font-medium', TONE_CLASS[tone], 'bg-transparent')}>
                    {t(`notifications.type_${n.type}`)}
                  </span>
                  <span aria-hidden>·</span>
                  {formatRelative(n.createdAt)}
                </span>
                <span className={cn('block truncate text-sm', !n.readAt && 'font-semibold')}>
                  {n.title}
                </span>
                {n.body && (
                  <span className="line-clamp-2 block text-13 text-muted-foreground">{n.body}</span>
                )}
              </span>
              {!n.readAt && (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">{t('notifications.unread')}</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
