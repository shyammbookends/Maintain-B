import {
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Inbox,
  LogOut,
  Megaphone,
  Package,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { fullName } from '@maintainx/shared'
import { MessagesSquare, ShieldCheck } from 'lucide-react'
import { AppCard, MenuList, ProfileBanner } from '@/components/mobile/kit'
import { initialsOf } from '@/components/mobile/tones'
import { usePhone } from '@/hooks/usePhone'
import { useChatUnread } from '@/services/chat.service'

/**
 * Secondary destinations (the tab bar keeps the five most used).
 */
export function WorkerMorePage() {
  const phone = usePhone()
  return phone ? <WorkerMoreMobile /> : <WorkerMoreDesktop />
}

/** Flutter `WorkerMoreScreen`: profile banner, one colourful list, sign out. */
function WorkerMoreMobile() {
  const { t } = useTranslation()
  const { logout, can } = useAuth()
  const user = useCurrentUser()
  const chat = useChatUnread()
  const doesWork = can('work_orders:view')
  const items = [
    { to: '/w/report', title: t('report.title'), icon: Megaphone },
    { to: '/w/chat', title: t('nav.chat'), icon: MessagesSquare, badge: chat.data },
    ...(doesWork ? [{ to: '/w/schedule', title: t('nav.schedule'), icon: CalendarDays }] : []),
    ...(can('inspections:view')
      ? [{ to: '/w/checklists', title: t('nav.checklists'), icon: ClipboardCheck }]
      : []),
    ...(doesWork ? [{ to: '/w/reports', title: t('report.mine'), icon: Inbox }] : []),
    { to: '/w/assets', title: t('nav.myAssets'), icon: Package },
    { to: '/w/restaurants', title: t('nav.myRestaurants'), icon: Building2 },
    { to: '/w/account', title: t('worker.profile'), icon: UserRound },
  ]
  return (
    <>
      <WorkerPageHeader title={t('worker.moreTitle')} />
      <div className="grid gap-4 p-4">
        <ProfileBanner
          initials={initialsOf(user)}
          name={fullName(user)}
          role={user.roles[0]?.name}
          roleIcon={ShieldCheck}
          to="/w/account"
        />
        <MenuList items={items} />
        <AppCard padding="px-3.5 py-2">
          <label className="flex min-h-11 items-center gap-3">
            <span className="flex-1 text-[15px] font-semibold">{t('worker.language')}</span>
            <LanguageSwitcher className="h-11 w-40" />
          </label>
        </AppCard>
        <button type="button" className="m-signout" onClick={() => void logout()}>
          <LogOut className="size-5" aria-hidden /> {t('actions.signOut')}
        </button>
      </div>
    </>
  )
}

function WorkerMoreDesktop() {
  const { t } = useTranslation()
  const { logout, can } = useAuth()
  const items: Array<{ to: string; label: string; icon: LucideIcon }> = [
    ...(can('work_orders:view')
      ? [{ to: '/w/schedule', label: t('nav.schedule'), icon: CalendarDays }]
      : []),
    ...(can('inspections:view')
      ? [{ to: '/w/checklists', label: t('nav.checklists'), icon: ClipboardCheck }]
      : []),
    { to: '/w/report', label: t('report.title'), icon: Megaphone },
    { to: '/w/reports', label: t('report.mine'), icon: Inbox },
    { to: '/w/assets', label: t('nav.myAssets'), icon: Package },
    { to: '/w/restaurants', label: t('nav.myRestaurants'), icon: Building2 },
    { to: '/w/account', label: t('worker.profile'), icon: UserRound },
  ]

  return (
    <>
      <WorkerPageHeader title={t('worker.moreTitle')} />
      <div className="grid gap-4 px-4 py-4">
        <ul className="divide-y overflow-hidden rounded-lg border">
          {items.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex h-14 items-center gap-3 px-4 text-base active:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <Icon className="size-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">{label}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <span className="text-base">{t('worker.language')}</span>
          <LanguageSwitcher className="h-11 w-36 text-base" />
        </div>
        <Button variant="secondary" size="xl" onClick={() => void logout()}>
          <LogOut aria-hidden /> {t('actions.signOut')}
        </Button>
      </div>
    </>
  )
}
