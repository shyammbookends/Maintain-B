import { fullName } from '@maintainx/shared'
import { ArrowLeft, Bell, Globe, LogOut, MessageSquare, ShieldCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, matchPath, useLocation } from 'react-router'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { RestaurantSwitcher } from '@/components/common/RestaurantSwitcher'
import { AppCard, MenuList, ProfileBanner } from '@/components/mobile/kit'
import { initialsOf } from '@/components/mobile/tones'
import { useAuth, useCurrentUser } from '@/contexts/AuthContext'
import { useChatUnread } from '@/services/chat.service'
import { useUnreadCount } from '@/services/platform.service'
import { useMobileBar, type MobileBarStore } from './mobile-bar'
import type { NavGroup } from './navigation'

/*
 * Phone-only chrome of the admin app (rendered only below 1024px): a Flutter
 * style app bar, the Menu screen and the round chat button.
 */

/** Tabs of the bottom bar; everything else lives in the Menu screen. */
export const ADMIN_TAB_KEYS = ['dashboard', 'work-orders', 'requests', 'assets'] as const

function useNavTitle(nav: NavGroup[]) {
  const { pathname } = useLocation()
  const items = nav.flatMap((g) => g.items)
  const hit =
    items.find((i) => matchPath({ path: i.to, end: true }, pathname)) ??
    items.find((i) => !i.end && matchPath({ path: i.to, end: false }, pathname))
  return hit?.label
}

function BellLink({ to }: { to: string }) {
  const { t } = useTranslation()
  const unread = useUnreadCount()
  const count = unread.data?.count ?? 0
  return (
    <Link
      to={to}
      className="m-icon-btn relative"
      aria-label={count ? t('notifications.bellUnread', { count }) : t('notifications.title')}
    >
      <Bell aria-hidden className="size-6" strokeWidth={1.75} />
      {count > 0 && (
        <span aria-hidden className="m-badge absolute top-1.5 left-[25px]">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

/** Admin app bar on a phone: back arrow, page title, notification bell. */
export function AdminMobileAppBar({ nav, store }: { nav: NavGroup[]; store: MobileBarStore }) {
  const { t } = useTranslation()
  const bar = useMobileBar(store)
  const fallback = useNavTitle(nav)
  // Detail pages (with a back arrow) name their section, like the Flutter app's
  // "Asset" / "Work order" bars; the record's own title is the big heading below.
  const title = (bar?.back ? fallback : bar?.title) ?? bar?.title ?? fallback ?? t('app.name')
  return (
    <div data-m="appbar" className="flex h-14 w-full min-w-0 items-center gap-1">
      {bar?.back && (
        <Link to={bar.back} className="m-icon-btn -ml-2" aria-label={t('actions.back')}>
          <ArrowLeft aria-hidden className="size-6" />
        </Link>
      )}
      <span aria-hidden className="m-appbar-title min-w-0 flex-1 truncate">
        {title}
      </span>
      <BellLink to="/notifications" />
    </div>
  )
}

/** Admin "Menu" tab: profile, restaurant, every other module, language, sign out. */
export function AdminMobileMenu({ nav, onClose }: { nav: NavGroup[]; onClose: () => void }) {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const { logout } = useAuth()
  const heading = useRef<HTMLHeadingElement>(null)
  const unread = useUnreadCount()

  useEffect(() => {
    heading.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = nav
    .map((g, i) => ({
      key: g.key,
      label: g.label ?? t('nav.groupWork'),
      items: [
        ...g.items
          // Tabs are in the bottom bar; the account is the profile card at the top.
          .filter((it) => !(ADMIN_TAB_KEYS as readonly string[]).includes(it.key))
          .filter((it) => it.to !== '/account')
          .map((it) => ({
            key: it.key,
            icon: it.icon,
            title: it.label,
            to: it.to,
            badge: it.badge,
          })),
        ...(i === 0
          ? [
              {
                key: 'notifications',
                icon: Bell,
                title: t('nav.notifications'),
                to: '/notifications',
                badge: unread.data?.count,
              },
            ]
          : []),
      ],
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div
      role="region"
      aria-labelledby="m-menu-title"
      data-m="menu-screen"
      className="m-menu-screen"
    >
      <div data-m="header" className="m-menu-bar">
        <h2 id="m-menu-title" ref={heading} tabIndex={-1} className="m-appbar-title outline-none">
          {t('nav.menu')}
        </h2>
      </div>
      <div className="grid gap-0 p-4 pb-8">
        <ProfileBanner
          initials={initialsOf(user)}
          name={fullName(user)}
          role={user.roles[0]?.name}
          roleIcon={ShieldCheck}
          to="/account"
          onNavigate={onClose}
        />
        {user.restaurants.length > 1 && (
          <>
            <p className="m-group-label">{t('scope.label')}</p>
            <AppCard className="m-scope" padding="p-2">
              <RestaurantSwitcher />
            </AppCard>
          </>
        )}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <p className="m-group-label">{g.label}</p>
            <MenuList items={g.items} onNavigate={onClose} />
          </section>
        ))}
        <p className="m-group-label">{t('common.language')}</p>
        <AppCard padding="px-3.5 py-2">
          <label className="flex min-h-11 items-center gap-3">
            <Globe className="size-5 text-[#64748b]" aria-hidden />
            <span className="flex-1 text-[15px] font-semibold">{t('worker.language')}</span>
            <LanguageSwitcher className="h-11 w-40" />
          </label>
        </AppCard>
        <button type="button" className="m-signout mt-5" onClick={() => void logout()}>
          <LogOut className="size-5" aria-hidden /> {t('actions.signOut')}
        </button>
      </div>
    </div>
  )
}

/** Round chat button above the tab bar, with the unread count — Flutter `ChatFab`. */
export function ChatFab({ to }: { to: string }) {
  const { t } = useTranslation()
  const unread = useChatUnread()
  const n = unread.data ?? 0
  return (
    <Link
      to={to}
      data-m="chat-fab"
      className="m-chat-fab"
      aria-label={n ? `${t('nav.chat')} (${n})` : t('nav.chat')}
    >
      <MessageSquare className="size-[26px]" aria-hidden strokeWidth={1.9} />
      {n > 0 && (
        <span aria-hidden className="m-badge absolute -top-1 -right-1">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  )
}
