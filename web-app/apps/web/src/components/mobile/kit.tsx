import { ArrowRight, ArrowUpRight, ChevronRight, type LucideIcon } from 'lucide-react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/utils/cn'
import { MENU_TONES, TONE_ACCENT, TONE_SOFT, alpha, type MTone } from './tones'

/*
 * Phone building blocks: the same widgets as the Flutter app
 * (mobile-app/lib/widgets/common.dart). Rendered only on phones (usePhone),
 * so nothing here ever reaches the desktop layout.
 */

function pressKeys(onClick?: () => void) {
  if (!onClick) return undefined
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }
}

interface AppCardProps {
  children: ReactNode
  to?: string
  onClick?: () => void
  className?: string
  /** Inner padding; Flutter's default is 14px. */
  padding?: string
  borderColor?: string
  style?: CSSProperties
  label?: string
}

/** White rounded card with a soft lift — Flutter `AppCard`. */
export function AppCard({
  children,
  to,
  onClick,
  className,
  padding = 'p-3.5',
  borderColor,
  style,
  label,
}: AppCardProps) {
  const classes = cn(
    'm-card block overflow-hidden rounded-[18px] border bg-white text-left text-[#0f172a]',
    'shadow-[0_6px_18px_rgba(49,46,129,0.06)]',
    (to || onClick) && 'm-press cursor-pointer',
    padding,
    className,
  )
  const s = { borderColor: borderColor ?? '#edf0f6', ...style }
  if (to)
    return (
      <Link to={to} className={classes} style={s} aria-label={label}>
        {children}
      </Link>
    )
  if (onClick)
    return (
      <div
        role="link"
        tabIndex={0}
        aria-label={label}
        className={classes}
        style={s}
        onClick={onClick}
        onKeyDown={pressKeys(onClick)}
      >
        {children}
      </div>
    )
  return (
    <div className={classes} style={s}>
      {children}
    </div>
  )
}

/** Tinted rounded square with an icon — Flutter `IconChip`. */
export function IconChip({
  icon: Icon,
  tone = 'info',
  size = 38,
  brand = false,
}: {
  icon: LucideIcon
  tone?: MTone
  size?: number
  brand?: boolean
}) {
  const c = TONE_SOFT[tone]
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center', brand && 'm-brand')}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: brand ? undefined : c.bg,
        color: brand ? '#fff' : c.fg,
      }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </span>
  )
}

/** Small rounded label — Flutter `Pill`. */
export function MPill({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: ReactNode
  tone?: MTone
  icon?: LucideIcon
  className?: string
}) {
  const c = TONE_SOFT[tone]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.75 text-[11.5px] leading-tight font-semibold whitespace-nowrap',
        className,
      )}
      style={{ background: c.bg, color: c.fg }}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  )
}

/** Round gradient avatar with initials — Flutter `Avatar`. */
export function MAvatar({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="m-brand flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  )
}

/** Heading with a small brand accent — Flutter `SectionTitle`. */
export function SectionTitle({
  children,
  trailing,
  id,
}: {
  children: ReactNode
  trailing?: ReactNode
  id?: string
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 pt-2 pb-1">
      <span aria-hidden className="m-brand h-4.5 w-1 shrink-0 rounded" />
      <h2 id={id} className="min-w-0 flex-1 text-[16.5px] font-bold tracking-[-0.2px]">
        {children}
      </h2>
      {trailing}
    </div>
  )
}

export interface HeroAction {
  icon: LucideIcon
  label: string
  to: string
}

/** Where the dashboard banner's bubbles start, how big they are and how they rise. */
const BUBBLES = [
  { left: '6%', size: 14, dur: '9s', delay: '0s' },
  { left: '22%', size: 22, dur: '11s', delay: '2.5s' },
  { left: '40%', size: 10, dur: '8s', delay: '1s' },
  { left: '58%', size: 26, dur: '12s', delay: '4s' },
  { left: '74%', size: 12, dur: '9.5s', delay: '6s' },
  { left: '88%', size: 18, dur: '10.5s', delay: '3s' },
]

/** Gradient greeting banner — Flutter `BrandHero`. */
export function BrandHero({
  overline,
  title,
  subtitle,
  initials,
  actions = [],
  titleAs: Title = 'h1',
  blue = false,
}: {
  overline?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  initials?: string
  actions?: HeroAction[]
  titleAs?: 'h1' | 'h2'
  /** Bookends blue with rising bubbles (the admin dashboard banner). */
  blue?: boolean
}) {
  return (
    <section
      className={cn(
        'm-hero relative overflow-hidden rounded-3xl p-5 text-white',
        blue && 'm-hero--blue',
      )}
    >
      {blue &&
        BUBBLES.map((b, i) => (
          <span
            key={i}
            aria-hidden
            className="m-bubble"
            style={
              {
                left: b.left,
                width: b.size,
                height: b.size,
                '--dur': b.dur,
                '--delay': b.delay,
              } as CSSProperties
            }
          />
        ))}
      <span aria-hidden className="absolute -top-15 -right-10 size-42.5 rounded-full bg-white/10" />
      <span
        aria-hidden
        className="absolute right-15 -bottom-17.5 size-32.5 rounded-full bg-white/7"
      />
      <span aria-hidden className="absolute top-7.5 -left-7.5 size-17.5 rounded-full bg-white/6" />
      <div className="relative flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {overline && (
            <span className="inline-block max-w-full truncate rounded-full bg-white/16 px-2.5 py-1 text-xs font-semibold">
              {overline}
            </span>
          )}
          <Title className="mt-2.5 text-[25px] leading-tight font-bold tracking-[-0.4px]">
            {title}
          </Title>
          {subtitle && (
            <p className="mt-1.5 text-[13.5px] leading-snug text-white/88">{subtitle}</p>
          )}
        </div>
        {initials && (
          <span className="shrink-0 rounded-full bg-white/35 p-0.625" aria-hidden>
            <span className="flex size-11.5 items-center justify-center rounded-full bg-white text-[17px] font-bold text-[#4f46e5]">
              {initials}
            </span>
          </span>
        )}
      </div>
      {actions.length > 0 && (
        <div className="relative mt-4.5 flex gap-2.5">
          {actions.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="m-press flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-white/22 bg-white/16 px-2 py-2.75 text-[13px] font-semibold text-white"
            >
              <a.icon className="size-4.5 shrink-0" aria-hidden />
              <span className="truncate">{a.label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

/** Colourful number tile — Flutter `StatTile`. */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'info',
  to,
  alert = false,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: MTone
  to?: string
  alert?: boolean
}) {
  const accent = TONE_ACCENT[tone]
  const body = (
    <>
      <Icon
        aria-hidden
        className="pointer-events-none absolute -right-3.5 -bottom-4 size-19.5"
        style={{ color: alpha(accent, 0.07) }}
      />
      <span className="relative flex items-center">
        <span
          className="flex size-9 items-center justify-center rounded-[11px] text-white"
          style={{ background: accent, boxShadow: `0 4px 10px ${alpha(accent, 0.35)}` }}
        >
          <Icon className="size-4.75" aria-hidden />
        </span>
        <span className="flex-1" />
        {alert ? (
          <span aria-hidden className="size-2.25 rounded-full bg-[#e11d48]" />
        ) : to ? (
          <ArrowUpRight aria-hidden className="size-4.25" style={{ color: alpha(accent, 0.7) }} />
        ) : null}
      </span>
      <span className="relative block">
        <span className="block text-[26px] leading-none font-bold tracking-[-0.5px] tabular-nums">
          {value}
        </span>
        <span className="mt-1 block truncate text-[12.5px] font-medium text-[#64748b]">
          {label}
        </span>
      </span>
    </>
  )
  const classes =
    'm-press relative flex h-[118px] flex-col justify-between overflow-hidden rounded-[20px] border bg-white p-3.5 text-[#0f172a]'
  const style: CSSProperties = {
    borderColor: alert ? alpha('#e11d48', 0.45) : alpha(accent, 0.14),
    backgroundImage: `linear-gradient(135deg, ${alpha(accent, 0.13)}, ${alpha(accent, 0.03)})`,
  }
  return to ? (
    <Link to={to} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {body}
    </div>
  )
}

/** Two columns on phones, four on tablets — Flutter `StatGrid`. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
}

export interface MenuItem {
  icon: LucideIcon
  title: string
  to?: string
  onClick?: () => void
  badge?: number
  key?: string
}

/** Menu list in a card, each row with a colourful icon bubble — Flutter `MenuList`. */
export function MenuList({ items, onNavigate }: { items: MenuItem[]; onNavigate?: () => void }) {
  return (
    <AppCard padding="py-1">
      <ul>
        {items.map((it, i) => {
          const tone = MENU_TONES[i % MENU_TONES.length]!
          const accent = TONE_ACCENT[tone]
          const inner = (
            <>
              <span
                aria-hidden
                className="flex size-9.5 shrink-0 items-center justify-center rounded-xl"
                style={{ background: alpha(accent, 0.12), color: accent }}
              >
                <it.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{it.title}</span>
              {it.badge ? (
                <span className="min-w-5 rounded-full bg-[#e11d48] px-1.5 text-center text-[10.5px] leading-5 font-bold text-white">
                  {it.badge > 99 ? '99+' : it.badge}
                </span>
              ) : null}
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-[#f1f5f9] text-[#64748b]"
              >
                <ChevronRight className="size-4.5" />
              </span>
            </>
          )
          const cls =
            'm-press flex min-h-14 w-full items-center gap-4 px-3.5 py-2 text-left text-[#0f172a]'
          return (
            <li key={it.key ?? it.to ?? it.title} className="relative">
              {i > 0 && (
                <span aria-hidden className="absolute top-0 right-4 left-16 h-px bg-[#edf0f6]" />
              )}
              {it.to ? (
                <Link
                  to={it.to}
                  className={cls}
                  onClick={() => {
                    it.onClick?.()
                    onNavigate?.()
                  }}
                >
                  {inner}
                </Link>
              ) : (
                <button type="button" className={cls} onClick={it.onClick}>
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </AppCard>
  )
}

/** Profile summary at the top of Menu / More — Flutter `ProfileBanner`. */
export function ProfileBanner({
  initials,
  name,
  role,
  roleIcon: RoleIcon,
  to,
  onNavigate,
}: {
  initials: string
  name: string
  role?: string
  roleIcon?: LucideIcon
  to?: string
  onNavigate?: () => void
}) {
  const body = (
    <span className="flex items-center gap-3.5">
      <MAvatar initials={initials} size={52} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold tracking-[-0.2px]">{name}</span>
        {role && (
          <MPill tone="info" icon={RoleIcon} className="mt-1">
            {role}
          </MPill>
        )}
      </span>
      {to && <ChevronRight className="size-6 shrink-0 text-[#64748b]" aria-hidden />}
    </span>
  )
  if (!to) return <AppCard padding="p-4">{body}</AppCard>
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="m-card m-press block rounded-[18px] border border-[#edf0f6] bg-white p-4 text-[#0f172a] shadow-[0_6px_18px_rgba(49,46,129,0.06)]"
    >
      {body}
    </Link>
  )
}

/** Big tappable row with a gradient icon — Flutter `_QuickAction`. */
export function QuickAction({
  icon: Icon,
  title,
  hint,
  to,
  tone = 'info',
}: {
  icon: LucideIcon
  title: string
  hint: string
  to: string
  tone?: MTone
}) {
  const accent = TONE_ACCENT[tone]
  return (
    <AppCard to={to} padding="p-3.5">
      <span className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex size-11.5 shrink-0 items-center justify-center rounded-[14px] text-white"
          style={{
            background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 82%, black))`,
            boxShadow: `0 4px 10px ${alpha(accent, 0.3)}`,
          }}
        >
          <Icon className="size-5.75" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">{title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-[#64748b]">{hint}</span>
        </span>
        <span
          aria-hidden
          className="flex size-7.5 shrink-0 items-center justify-center rounded-full"
          style={{ background: alpha(accent, 0.1), color: accent }}
        >
          <ArrowRight className="size-4.25" />
        </span>
      </span>
    </AppCard>
  )
}

/** One small metric with a round icon — Flutter dashboard `_Metric`. */
export function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: MTone
}) {
  const accent = TONE_ACCENT[tone]
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center text-center">
      <span
        aria-hidden
        className="flex size-8.5 items-center justify-center rounded-full"
        style={{ background: alpha(accent, 0.12), color: accent }}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="mt-1.5 text-[17px] font-bold tabular-nums">{value}</span>
      <span className="mt-0.5 text-[11.5px] leading-tight text-[#64748b]">{label}</span>
    </div>
  )
}

/** Card list wrapper with Flutter's 10px gaps. */
export function CardList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('grid gap-2.5 sm:grid-cols-2', className)}>{children}</ul>
}

/**
 * One row of a Flutter list screen (admin_lists.dart): icon chip or avatar,
 * a 15px title, muted 12.5px lines, and something on the right.
 */
export function ListCard({
  to,
  onClick,
  icon,
  tone = 'info',
  leading,
  title,
  lines = [],
  trailing,
  top,
  bottom,
  borderColor,
  chevron = false,
}: {
  to?: string
  onClick?: () => void
  icon?: LucideIcon
  tone?: MTone
  leading?: ReactNode
  title: ReactNode
  lines?: ReactNode[]
  trailing?: ReactNode
  /** Row above the title (code + status), like the Flutter request / PO cards. */
  top?: ReactNode
  bottom?: ReactNode
  borderColor?: string
  chevron?: boolean
}) {
  return (
    <AppCard to={to} onClick={onClick} borderColor={borderColor} className="h-full">
      {top && <span className="mb-1.5 flex min-w-0 items-center gap-2">{top}</span>}
      <span className="flex min-w-0 items-center gap-3">
        {leading ?? (icon ? <IconChip icon={icon} tone={tone} /> : null)}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-semibold wrap-break-word">
            {title}
          </span>
          {lines
            .filter((l) => l !== null && l !== undefined && l !== '' && l !== false)
            .map((l, i) => (
              <span key={i} className="mt-0.5 block truncate text-[12.5px] text-[#64748b]">
                {l}
              </span>
            ))}
        </span>
        {trailing}
        {chevron && <ChevronRight className="size-5 shrink-0 text-[#64748b]" aria-hidden />}
      </span>
      {bottom && <span className="mt-2 flex min-w-0 items-center gap-2">{bottom}</span>}
    </AppCard>
  )
}
