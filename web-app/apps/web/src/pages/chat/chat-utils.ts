import type { ChatPerson } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate, formatDayMonth, formatTime, isSameLocalDay } from '@/utils/format'

/* Chat helpers: per-person colours, date labels and the viewer's chat role. */

/** Strong colours with white initials (all ≥ 4.5:1 on white, so they also work as name text). */
const PALETTE = [
  '#4338ca', // indigo
  '#6d28d9', // violet
  '#047857', // emerald
  '#b45309', // amber
  '#0369a1', // sky
  '#be123c', // rose
  '#0f766e', // teal
  '#a21caf', // fuchsia
  '#c2410c', // orange
] as const

/** The same colour for a person everywhere (avatar, name above their messages). */
export function personColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** List time: "4:30 pm" today, "Yesterday", else "2 Oct". */
export function listTime(iso: string, t: TFunction, now = new Date()): string {
  const d = new Date(iso)
  if (isSameLocalDay(d, now)) return formatTime(d)
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (isSameLocalDay(d, y)) return t('chat.yesterday')
  return formatDayMonth(d)
}

/** Separator between days: "Today", "Yesterday" or the date. */
export function dayLabel(iso: string, t: TFunction, now = new Date()): string {
  const d = new Date(iso)
  const diff = Math.round((dayOf(now).getTime() - dayOf(d).getTime()) / 86_400_000)
  if (diff === 0) return t('chat.today')
  if (diff === 1) return t('chat.yesterday')
  return formatDate(d)
}

/** Member names for a header line: "Asha, Ravi, Meena +3". */
export function memberLine(members: ChatPerson[], meId: string | undefined, t: TFunction, max = 3) {
  const names = members.map((m) => (m.id === meId ? t('chat.you') : m.firstName))
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max}`
}

/** Super Admins and Admins: run groups and can see every chat in their scope. */
export function useChatRole() {
  const { user } = useAuth()
  return {
    me: user,
    isAdmin: !!user && (user.isSuperAdmin || user.roleKind === 'ADMIN'),
    isSuperAdmin: !!user?.isSuperAdmin,
  }
}
