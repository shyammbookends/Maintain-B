import { BellRing, ClipboardCheck, Globe, QrCode, Wrench, type LucideIcon } from 'lucide-react'
import { usePhone } from '@/hooks/usePhone'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { BrandLogo, BrandMark } from './BrandMark'

/**
 * Sign-in / password screens. Desktop: brand panel on the left, form card on
 * the right. Phone: just the form, with the language choice always visible.
 */
export function AuthLayout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const phone = usePhone()
  if (phone) return <AuthLayoutMobile>{children}</AuthLayoutMobile>
  const features: Array<{ icon: LucideIcon; text: string }> = [
    { icon: Wrench, text: t('auth.featureWork') },
    { icon: QrCode, text: t('auth.featureQr') },
    { icon: ClipboardCheck, text: t('auth.featureChecklists') },
    { icon: BellRing, text: t('auth.featureAlerts') },
  ]
  return (
    <div className="bg-app flex min-h-dvh">
      {/* Brand panel (desktop) */}
      <aside className="bg-brand relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden p-10 lg:flex">
        <span
          aria-hidden
          className="absolute -top-24 -right-24 size-80 rounded-full bg-white/10 blur-3xl"
        />
        <span
          aria-hidden
          className="absolute -bottom-32 -left-16 size-96 rounded-full bg-white/5"
        />
        <div className="relative flex items-center gap-3">
          <BrandLogo className="size-10 rounded-[9px] ring-1 ring-white/30" />
          <span className="text-lg font-semibold">{t('app.name')}</span>
        </div>
        <div className="relative">
          <p className="text-3xl leading-tight font-semibold tracking-tight">
            {t('auth.heroTitle')}
          </p>
          <p className="mt-3 max-w-md text-white/85">{t('auth.heroBody')}</p>
          <ul className="stagger mt-8 grid gap-3">
            {features.map((f) => (
              <li key={f.text} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <f.icon className="size-4.5" aria-hidden />
                </span>
                <span className="text-sm text-white/95">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/75">{t('app.tagline')}</p>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        <header className="flex h-16 items-center justify-between px-4 sm:px-8">
          <BrandMark className="lg:invisible" />
          <LanguageSwitcher />
        </header>
        <main
          id="main-content"
          className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-12 lg:items-center lg:pt-0"
        >
          <div className="animate-pop w-full max-w-sm rounded-2xl border bg-card p-6 shadow-[0_20px_48px_-20px_oklch(0.3_0.08_262/0.3)] sm:p-8">
            {children ?? <Outlet />}
          </div>
        </main>
        <footer className="px-4 pb-6 text-center text-xs text-muted-foreground lg:hidden">
          {t('app.tagline')}
        </footer>
      </div>
    </div>
  )
}

/** Phone sign-in: the Flutter login screen (gradient header, overlapping card). */
function AuthLayoutMobile({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="bg-app min-h-dvh">
      <header data-m="auth-hero" className="m-brand text-white">
        <div className="flex items-center gap-3">
          <BrandLogo className="size-[46px] rounded-[10px] ring-1 ring-white/30" />
          <span className="min-w-0">
            <span className="block text-[17px] font-bold">{t('app.name')}</span>
            <span className="block truncate text-[12.5px] text-white/80">{t('app.tagline')}</span>
          </span>
        </div>
        <p className="mt-7 text-[24px] leading-tight font-bold tracking-[-0.3px]">
          {t('auth.heroTitle')}
        </p>
      </header>
      <main
        id="main-content"
        className="relative -mt-9 px-[calc(20px+var(--m-safe-left))] pb-[calc(24px+var(--m-safe-bottom))]"
      >
        <div data-m="auth-card" className="mx-auto max-w-md bg-card">
          {children ?? <Outlet />}
        </div>
        <div className="mx-auto mt-4 max-w-md rounded-[18px] border border-[#edf0f6] bg-white px-3.5 py-2 shadow-[0_6px_18px_rgba(49,46,129,0.06)]">
          <label className="flex min-h-11 items-center gap-3">
            <Globe className="size-5 text-[#64748b]" aria-hidden />
            <span className="flex-1 text-[15px] font-semibold">{t('common.language')}</span>
            <LanguageSwitcher className="h-11 w-40" />
          </label>
        </div>
      </main>
    </div>
  )
}
