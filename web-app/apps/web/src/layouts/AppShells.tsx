import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Home,
  Inbox,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Package,
  ScanLine,
  UserRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { GlobalSearch } from '@/components/common/GlobalSearch'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { RestaurantSwitcher } from '@/components/common/RestaurantSwitcher'
import { UserMenu } from '@/components/common/UserMenu'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/contexts/AuthContext'
import { useUnreadCount } from '@/services/platform.service'
import { useChatUnread } from '@/services/chat.service'
import { RestaurantScopeProvider } from '@/contexts/RestaurantScopeContext'
import { WorkflowProvider, useWorkflow } from '@/contexts/WorkflowContext'
import { AdminLayout } from './AdminLayout'
import { adminNavigation } from './admin-nav'
import { BrandMark } from './BrandMark'
import { filterNavigation, type NavItem } from './navigation'
import { WorkerLayout } from './WorkerLayout'

/*
 * The signed-in app shells. Navigation grows as modules are built:
 * Phase 5 adds the dashboard, Phase 6 the worker tabs.
 */

function useAdminNav() {
  // Cheap to rebuild; recomputing every render keeps labels in the current language.
  const { t } = useTranslation()
  const { can } = useAuth()
  const workflow = useWorkflow()
  const chatUnread = useChatUnread()
  const nav = filterNavigation(adminNavigation(t), can).map((g) => ({
    ...g,
    items: g.items.map((i) => (i.key === 'chat' ? { ...i, badge: chatUnread.data } : i)),
  }))
  // Stock counts is an extra tool, shown when the workflow turns it on.
  if (workflow && !workflow.showCycleCounts)
    return nav
      .map((g) => ({ ...g, items: g.items.filter((i) => i.key !== 'stock-counts') }))
      .filter((g) => g.items.length > 0)
  return nav
}

export function AdminShell() {
  return (
    <WorkflowProvider>
      <AdminShellInner />
    </WorkflowProvider>
  )
}

function AdminShellInner() {
  const nav = useAdminNav()
  return (
    <RestaurantScopeProvider>
      <AdminLayout
        nav={nav}
        brand={<BrandMark />}
        headerStart={<RestaurantSwitcher />}
        headerEnd={
          <>
            <GlobalSearch />
            <LanguageSwitcher className="hidden sm:block" />
            <NotificationBell />
            <UserMenu accountPath="/account" />
          </>
        }
      />
    </RestaurantScopeProvider>
  )
}

/** "/" for users without the dashboard: the first module they can open. */
export function AdminHome() {
  const nav = useAdminNav()
  // Chat is open to everyone, so it never counts as a module to land on.
  const first = nav.flatMap((g) => g.items).find((i) => i.key !== 'chat')?.to ?? '/account'
  return <Navigate to={first === '/' ? '/account' : first} replace />
}

function WorkerSidebarFooter() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  return (
    <div className="grid gap-2">
      {user && (
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span className="bg-brand flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {user.firstName.slice(0, 1)}
            {user.lastName.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {user.firstName} {user.lastName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {user.roles[0]?.name}
            </span>
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <LanguageSwitcher className="h-9 flex-1" />
        <button
          type="button"
          onClick={() => void logout()}
          aria-label={t('actions.signOut')}
          title={t('actions.signOut')}
          className="flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export function WorkerShell() {
  const { t } = useTranslation()
  const { can } = useAuth()
  const unread = useUnreadCount()
  const chatUnread = useChatUnread()
  // Requesters (restaurant staff) report problems; they have no tasks of their own.
  const doesWork = can('work_orders:view')
  // Schedule lives under More; alerts get a tab with a badge.
  const tabs: NavItem[] = [
    { key: 'home', label: t('nav.home'), to: '/w', icon: Home, end: true },
    doesWork
      ? { key: 'tasks', label: t('nav.myTasks'), to: '/w/tasks', icon: ClipboardList }
      : { key: 'reports', label: t('report.mine'), to: '/w/reports', icon: Inbox },
    { key: 'scan', label: t('nav.scan'), to: '/w/scan', icon: ScanLine },
    {
      key: 'notifications',
      // Short so it fits a phone tab without being cut ("Notificatio…").
      label: t('nav.alerts'),
      to: '/w/notifications',
      icon: Bell,
      badge: unread.data?.count,
    },
    { key: 'more', label: t('nav.more'), to: '/w/more', icon: Menu },
  ]
  // On desktops the sidebar shows these directly (on phones they're under More).
  const moreItems: NavItem[] = [
    { key: 'report', label: t('report.title'), to: '/w/report', icon: Megaphone },
    {
      key: 'chat',
      label: t('nav.chat'),
      to: '/w/chat',
      icon: MessagesSquare,
      badge: chatUnread.data,
    },
    ...(doesWork
      ? [{ key: 'schedule', label: t('nav.schedule'), to: '/w/schedule', icon: CalendarDays }]
      : []),
    ...(can('inspections:view')
      ? [
          {
            key: 'checklists',
            label: t('nav.checklists'),
            to: '/w/checklists',
            icon: ClipboardCheck,
          },
        ]
      : []),
    ...(doesWork
      ? [{ key: 'reports', label: t('report.mine'), to: '/w/reports', icon: Inbox }]
      : []),
    { key: 'assets', label: t('nav.myAssets'), to: '/w/assets', icon: Package },
    { key: 'restaurants', label: t('nav.myRestaurants'), to: '/w/restaurants', icon: Building2 },
    { key: 'account', label: t('worker.profile'), to: '/w/account', icon: UserRound },
  ]
  return (
    <WorkflowProvider>
      <WorkerLayout tabs={tabs} moreItems={moreItems} sidebarFooter={<WorkerSidebarFooter />} />
    </WorkflowProvider>
  )
}
