import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineBanner } from '@/components/common/OfflineBanner'
import { NavLink, Outlet, useLocation, useMatches } from 'react-router'
import { cn } from '@/utils/cn'
import { BrandMark } from './BrandMark'
import type { LayoutRouteHandle, NavItem } from './navigation'
import { SkipLink } from './SkipLink'
import { usePhone } from '@/hooks/usePhone'
import { ChatFab } from './MobileChrome'
import { isTabRoot } from './mobile-bar'

/** Tab screens that show the round chat button on phones (not Scan, like the Flutter app). */
const CHAT_ROOTS = ['/w', '/w/tasks', '/w/reports', '/w/notifications', '/w/more']

interface WorkerLayoutProps {
  /** Bottom tab bar items on phones (keep to 5). Also the top of the desktop sidebar. */
  tabs: NavItem[]
  /** Extra destinations shown in the desktop sidebar (on phones they live under "More"). */
  moreItems?: NavItem[]
  /** Bottom of the desktop sidebar (signed-in user, language, sign out). */
  sidebarFooter?: ReactNode
  children?: ReactNode
}

function SideLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground',
          'transition-all duration-(--duration-base) hover:translate-x-0.5 hover:bg-sidebar-accent',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          isActive &&
            'bg-info-soft font-semibold text-info-fg before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-primary hover:translate-x-0 hover:bg-info-soft',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            aria-hidden
            className={cn('size-4.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="truncate">{item.label}</span>
          {item.badge ? (
            <span className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 text-center text-[11px] leading-5 font-semibold text-destructive-foreground tabular">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

/**
 * Worker shell, one app at every size:
 *  - phones / tablets: full-width app column, fixed bottom tab bar with 64px
 *    touch targets, iOS safe-area aware;
 *  - laptops / desktops (≥1024px): dashboard layout with a sidebar and a wide
 *    content card, no bottom bar.
 * Routes can hide the phone tab bar with `handle: { hideWorkerNav: true }`.
 */
export function WorkerLayout({ tabs, moreItems = [], sidebarFooter, children }: WorkerLayoutProps) {
  const { t } = useTranslation()
  const matches = useMatches()
  const location = useLocation()
  const hideNav = matches.some((m) => (m.handle as LayoutRouteHandle | undefined)?.hideWorkerNav)
  const phone = usePhone()

  return (
    <div className="bg-app min-h-dvh">
      <SkipLink />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-background/90 backdrop-blur lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <BrandMark subtitle={t('worker.appSubtitle')} />
        </div>
        <nav aria-label={t('nav.menu')} className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="grid gap-0.5">
            {/* "More" is a phone screen; the sidebar lists its items directly. */}
            {tabs
              .filter((item) => moreItems.length === 0 || item.key !== 'more')
              .map((item) => (
                <li key={item.key}>
                  <SideLink item={item} />
                </li>
              ))}
          </ul>
          {moreItems.length > 0 && (
            <>
              <p className="mt-5 mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {t('worker.shortcuts')}
              </p>
              <ul className="grid gap-0.5">
                {moreItems.map((item) => (
                  <li key={item.key}>
                    <SideLink item={item} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
        {sidebarFooter && (
          <div className="shrink-0 border-t border-sidebar-border p-3">{sidebarFooter}</div>
        )}
      </aside>

      <div className="lg:pl-64">
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'mx-auto min-h-dvh w-full max-w-2xl bg-background outline-none sm:border-x',
            // Desktop: a wide card on the tinted canvas.
            'lg:my-6 lg:min-h-[calc(100dvh-3rem)] lg:max-w-5xl lg:overflow-clip lg:rounded-2xl lg:border lg:shadow-card',
            hideNav ? 'pb-safe' : 'pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-6',
          )}
        >
          <OfflineBanner />
          <div key={location.pathname} className="animate-rise">
            {children ?? <Outlet />}
          </div>
        </main>
      </div>

      {phone && !hideNav && isTabRoot(location.pathname, CHAT_ROOTS) && <ChatFab to="/w/chat" />}
      {!hideNav && (
        <nav
          aria-label={t('nav.main')}
          data-m="w-nav"
          className="glass fixed inset-x-0 bottom-0 z-30 border-t pb-safe lg:hidden"
        >
          <ul
            className="mx-auto grid max-w-2xl"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((tab) => (
              <li key={tab.key}>
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                      'transition-colors duration-(--duration-fast)',
                      'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
                      isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className="animate-pop absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                        />
                      )}
                      <span
                        className={cn(
                          'relative flex h-7 w-12 items-center justify-center rounded-full transition-all duration-(--duration-base)',
                          isActive && 'bg-info-soft',
                        )}
                      >
                        <tab.icon
                          aria-hidden
                          className={cn(
                            'size-5 transition-transform duration-(--duration-base)',
                            isActive && 'scale-110',
                          )}
                          strokeWidth={isActive ? 2.25 : 1.75}
                        />
                        {tab.badge ? (
                          <span className="animate-pop absolute -top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-destructive-foreground tabular">
                            {tab.badge > 9 ? '9+' : tab.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="max-w-full truncate px-1">{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
