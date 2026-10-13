import { fullName, type ChatPerson, type ConversationListItem } from '@maintainx/shared'
import type { TFunction } from 'i18next'
import { Eye, Users } from 'lucide-react'
import { initialsOf } from '@/components/ui/avatar'
import { cn } from '@/utils/cn'
import { personColor } from './chat-utils'

/* Small building blocks of the chat page: avatars and the "View only" tag. */

export function PersonAvatar({
  person,
  size = 40,
  single = false,
  className,
}: {
  person: { id: string; firstName: string; lastName: string }
  size?: number
  /** Only the first initial (tiny paired avatars). */
  single?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: personColor(person.id),
      }}
    >
      {single ? initialsOf(person.firstName).slice(0, 1) : initialsOf(fullName(person))}
    </span>
  )
}

/** Group chats: a people icon in a brand circle. */
export function GroupAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('bg-brand flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <Users style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  )
}

/** The avatar of a conversation from the viewer's side. */
export function ConversationAvatar({
  c,
  meId,
  size = 40,
}: {
  c: ConversationListItem
  meId: string | undefined
  size?: number
}) {
  if (c.type === 'GROUP') return <GroupAvatar size={size} />
  const other = c.members.find((m) => m.id !== meId) ?? c.members[0]
  if (!other) return <GroupAvatar size={size} />
  if (c.viewOnly && c.members.length > 1) {
    // Overseen direct chat: both people, overlapping.
    const [a, b] = c.members as [ChatPerson, ChatPerson]
    const s = Math.round(size * 0.64)
    return (
      <span aria-hidden className="relative shrink-0" style={{ width: size, height: size }}>
        <PersonAvatar person={a} size={s} single className="absolute top-0 left-0" />
        <PersonAvatar
          person={b}
          size={s}
          single
          className="absolute right-0 bottom-0 ring-2 ring-white"
        />
      </span>
    )
  }
  return <PersonAvatar person={other} size={size} />
}

/** Small "View only" tag for overseen chats. */
export function ViewOnlyTag({ t, className }: { t: TFunction; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-[11px] leading-none font-medium text-warning-fg',
        className,
      )}
    >
      <Eye className="size-3" aria-hidden />
      {t('chat.viewOnly')}
    </span>
  )
}
