import { Bell, CalendarDays, ClipboardList, Home, Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NavItem } from '@/layouts/navigation'
import { WorkerLayout } from '@/layouts/WorkerLayout'

/** Gallery: the real WorkerLayout with the real worker tab set, pointed at preview pages. */
export function WorkerPreviewShell() {
  const { t } = useTranslation()
  const tabs: NavItem[] = [
    { key: 'home', label: t('nav.home'), to: '/design/worker', icon: Home, end: true },
    { key: 'tasks', label: t('nav.myTasks'), to: '/design/worker/tasks', icon: ClipboardList },
    {
      key: 'schedule',
      label: t('nav.schedule'),
      to: '/design/worker/schedule',
      icon: CalendarDays,
    },
    {
      key: 'notifications',
      label: t('nav.notifications'),
      to: '/design/worker/notifications',
      icon: Bell,
      badge: 2,
    },
    { key: 'more', label: t('nav.more'), to: '/design/worker/more', icon: Menu },
  ]
  return <WorkerLayout tabs={tabs} />
}
