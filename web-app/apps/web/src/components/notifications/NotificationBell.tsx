import { useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  notificationsApi,
  platformKeys,
  useNotifications,
  useUnreadCount,
} from '@/services/platform.service'
import { NotificationList } from './NotificationList'

/** Header bell with the unread count and the latest notifications. */
export function NotificationBell() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const unread = useUnreadCount()
  const latest = useNotifications({ pageSize: 8 }, open)
  const count = unread.data?.count ?? 0

  async function readAll() {
    await notificationsApi.readAll()
    await qc.invalidateQueries({ queryKey: platformKeys.notifications })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count ? t('notifications.bellUnread', { count }) : t('notifications.title')}
        >
          <Bell />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-destructive-foreground tabular"
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="bg-brand flex items-center justify-between rounded-t-md px-4 py-3 text-white">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4" aria-hidden />
            {t('notifications.title')}
            {count > 0 && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium tabular">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </span>
          {count > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-white underline-offset-4 hover:text-white"
              onClick={() => void readAll()}
            >
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {latest.isPending ? (
            <div className="grid gap-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (latest.data?.data.length ?? 0) === 0 ? (
            <p className="flex items-center gap-2 px-4 py-6 text-13 text-muted-foreground">
              <BellOff className="size-4" aria-hidden /> {t('notifications.empty')}
            </p>
          ) : (
            <NotificationList items={latest.data!.data} onNavigate={() => setOpen(false)} />
          )}
        </div>
        <div className="border-t bg-muted/40 px-4 py-2.5 text-center">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-13 font-medium text-primary hover:underline"
          >
            {t('notifications.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
