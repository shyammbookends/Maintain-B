import { ChevronDown, Menu } from 'lucide-react'
import { MobileTabBar } from './MobileTabBar'
import { useEffect, useState, type ReactNode } from 'react'
import { OfflineBanner } from '@/components/common/OfflineBanner'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/utils/cn'
import type { NavGroup } from './navigation'
import { SkipLink } from './SkipLink'
import { usePhone } from '@/hooks/usePhone'
import { MobileBarContext, MobileBarStore, isTabRoot } from './mobile-bar'
import { AdminMobileAppBar, AdminMobileMenu, ChatFab } from './MobileChrome'

const TAB_ROOTS = ['/', '/work-orders', '/requests', '/assets']

interface AdminLayoutProps {
  nav: NavGroup[]
  /** Top of the sidebar (logo / product name). */
  brand: ReactNode
  /** Left side of the top bar (e.g. restaurant scope switcher, breadcrumbs). */
  headerStart?: ReactNode
  /** Right side of the top bar (notifications, user menu). */
  headerEnd?: ReactNode
  /** Bottom of the sidebar (e.g. signed-in user). */
  sidebarFooter?: ReactNode
  /** Defaults to the nested route <Outlet />. */
  children?: ReactNode
}

const FOLD_KEY = 'mx.nav.open'

function readOpenGroups(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function NavItems({
  group,
  onNavigate,
  id,
}: {
  group: NavGroup
  onNavigate?: () => void
  id?: string
}) {
  return (
    <ul id={id} className="grid gap-px">
      {group.items.map((item) => (
        <li key={item.key}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground',
                'transition-all duration-(--duration-base) hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                isActive &&
                  'bg-info-soft font-semibold text-info-fg before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-primary hover:translate-x-0 hover:bg-info-soft hover:text-info-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span className="ml-auto rounded-sm bg-muted px-1.5 text-xs font-medium tabular text-muted-foreground">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

const groupLabelClass =
  'mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'

function SidebarNav({ nav, onNavigate }: { nav: NavGroup[]; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState<string[]>(readOpenGroups)
  // Groups folded by hand on this page although they hold it (forgotten on navigation).
  const [foldedOn, setFoldedOn] = useState<{ path: string; keys: string[] }>({ path: '', keys: [] })
  const folded = foldedOn.path === pathname ? foldedOn.keys : []
  const toggle = (key: string, expanded: boolean) => {
    // Toggle what is shown: a group open because it holds the current page folds on the first click.
    const next = expanded ? open.filter((k) => k !== key) : [...open, key]
    setOpen(next)
    setFoldedOn({
      path: pathname,
      keys: expanded ? [...folded, key] : folded.filter((k) => k !== key),
    })
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next))
    } catch {
      // Not remembered; the toggle still works.
    }
  }
  const holdsActive = (group: NavGroup) =>
    group.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))

  return (
    <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto px-3 py-3">
      {nav.map((group) => {
        if (!group.collapsible) {
          return (
            <div key={group.key} className="mb-4 last:mb-0">
              {group.label && <p className={groupLabelClass}>{group.label}</p>}
              <NavItems group={group} onNavigate={onNavigate} />
            </div>
          )
        }
        const expanded =
          !folded.includes(group.key) && (open.includes(group.key) || holdsActive(group))
        const listId = `nav-group-${group.key}`
        return (
          <div key={group.key} className="mb-4 last:mb-0">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => toggle(group.key, expanded)}
              className={cn(
                groupLabelClass,
                'flex w-full items-center justify-between rounded-md py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
              )}
            >
              {group.label}
              <ChevronDown
                aria-hidden
                className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
              />
            </button>
            {expanded && <NavItems id={listId} group={group} onNavigate={onNavigate} />}
          </div>
        )
      })}
    </nav>
  )
}

/**
 * Desktop shell for Super Admin and Admin: fixed sidebar ≥1024px, slide-in
 * drawer below that. Content area is width-capped for readable tables/forms.
 */
export function AdminLayout({
  nav,
  brand,
  headerStart,
  headerEnd,
  sidebarFooter,
  children,
}: AdminLayoutProps) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  // Phones (< 1024px) get the Flutter app's chrome instead: app bar, Menu screen, chat button.
  const phone = usePhone()
  const [barStore] = useState(() => new MobileBarStore())
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-5">
        {brand}
      </div>
      <SidebarNav nav={nav} onNavigate={onNavigate} />
      {sidebarFooter && (
        <div className="shrink-0 border-t border-sidebar-border p-3">{sidebarFooter}</div>
      )}
    </>
  )

  return (
    <div className="bg-app min-h-dvh">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-background/90 backdrop-blur lg:flex">
        {sidebar()}
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <header
          data-m="header"
          className="glass sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-6"
        >
          {phone ? (
            <AdminMobileAppBar nav={nav} store={barStore} />
          ) : (
            <>
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 lg:hidden"
                    aria-label={t('actions.openMenu')}
                  >
                    <Menu />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-72 bg-sidebar p-0"
                  aria-describedby={undefined}
                >
                  <SheetTitle className="sr-only">{t('nav.main')}</SheetTitle>
                  <div className="flex h-full flex-col">{sidebar(() => setMobileOpen(false))}</div>
                </SheetContent>
              </Sheet>
              <div className="flex min-w-0 flex-1 items-center gap-3">{headerStart}</div>
              {headerEnd && <div className="flex shrink-0 items-center gap-2">{headerEnd}</div>}
            </>
          )}
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          data-m="main"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none lg:px-8"
        >
          <OfflineBanner />
          <div key={location.pathname} className="animate-rise">
            <MobileBarContext.Provider value={barStore}>
              {children ?? <Outlet />}
            </MobileBarContext.Provider>
          </div>
        </main>
      </div>
      {phone && menuOpen && <AdminMobileMenu nav={nav} onClose={() => setMenuOpen(false)} />}
      {phone && !menuOpen && isTabRoot(location.pathname, TAB_ROOTS) && <ChatFab to="/chat" />}
      <MobileTabBar
        nav={nav}
        menuOpen={phone ? menuOpen : undefined}
        onTab={() => setMenuOpen(false)}
        onMenu={() => (phone ? setMenuOpen((o) => !o) : setMobileOpen(true))}
      />
    </div>
  )
}
