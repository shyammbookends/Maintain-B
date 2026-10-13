import {
  formatVoiceDuration,
  fullName,
  type ChatListScope,
  type ChatMessageDto,
  type ConversationListItem,
} from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  ArrowLeft,
  ClipboardList,
  Eye,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Send,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { usePhone } from '@/hooks/usePhone'
import { chatApi, chatKeys, useConversations } from '@/services/chat.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatDateTime, formatTime, isSameLocalDay } from '@/utils/format'
import { MembersDialog, NewChatDialog, NewGroupDialog } from './ChatDialogs'
import { MicButton, RecordingBar, VoicePlayer } from './chat-voice'
import { canRecordVoice, useVoiceRecorder, type VoiceClip } from './use-voice-recorder'
import { ConversationAvatar, PersonAvatar, ViewOnlyTag } from './chat-ui'
import { dayLabel, listTime, memberLine, personColor, useChatRole } from './chat-utils'

/** New messages in the open chat are fetched this often. */
const POLL_MS = 4_000
/** Messages from one person within this gap form one run (one avatar, one name). */
const RUN_GAP_MS = 5 * 60_000

/**
 * Team chat. Desktop: the list of chats beside the open one. Phones (< 1024px):
 * the list is a screen of its own and an open chat covers the whole screen,
 * like the Flutter app. `base` is "/chat" in the admin app and "/w/chat" for
 * workers. Admins can switch to "All chats" (`?view=all`): chats they oversee
 * open read-only.
 */
export function ChatPage({ base }: { base: string }) {
  const { t } = useTranslation()
  const phone = usePhone()
  const { conversationId } = useParams()
  const [params, setParams] = useSearchParams()
  const { isAdmin } = useChatRole()
  const scope: ChatListScope = isAdmin && params.get('view') === 'all' ? 'all' : 'mine'
  const list = useConversations(scope)
  const found = list.data?.find((c) => c.id === conversationId)
  // An overseen chat opened from a link while "My chats" is shown.
  const fallback = useConversations(
    'all',
    isAdmin && scope === 'mine' && !!conversationId && list.isSuccess && !found,
  )
  const open = found ?? fallback.data?.find((c) => c.id === conversationId) ?? null
  const [dialog, setDialog] = useState<'chat' | 'group' | null>(null)

  const qs = scope === 'all' ? '?view=all' : ''
  const link = (id: string) => `${base}/${id}${qs}`
  const listHref = `${base}${qs}`
  const setScope = (s: ChatListScope) =>
    setParams(s === 'all' ? { view: 'all' } : {}, { replace: true })
  const unread = (list.data ?? []).reduce((n, c) => n + c.unread, 0)
  const waiting = list.isPending || (fallback.isFetching && !open)

  const dialogs = (
    <>
      <NewChatDialog
        open={dialog === 'chat'}
        onOpenChange={(o) => setDialog(o ? 'chat' : null)}
        link={link}
      />
      {isAdmin && (
        <NewGroupDialog
          open={dialog === 'group'}
          onOpenChange={(o) => setDialog(o ? 'group' : null)}
          link={link}
        />
      )}
    </>
  )

  const rows = (
    <ConversationList list={list} scope={scope} active={conversationId} link={link} flat={phone} />
  )

  if (phone) {
    if (conversationId)
      return createPortal(
        <div data-m="chat-room" className="m-chat-room">
          {open ? (
            <ChatThread key={open.id} c={open} listHref={listHref} phone />
          ) : (
            <>
              <ThreadBar listHref={listHref} phone>
                <span className="m-appbar-title">{t('chat.title')}</span>
              </ThreadBar>
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
                {waiting ? <Spinner /> : t('chat.notFound')}
              </div>
            </>
          )}
        </div>,
        document.body,
      )
    return (
      <>
        {base.startsWith('/w') && <WorkerPageHeader title={t('chat.title')} />}
        <div className={cn('grid gap-3', base.startsWith('/w') && 'p-4')}>
          {isAdmin && <ScopeSwitch scope={scope} onChange={setScope} phone />}
          {isAdmin && (
            <div className="flex">
              <Button variant="secondary" onClick={() => setDialog('group')}>
                <UsersRound aria-hidden /> {t('chat.newGroup')}
              </Button>
            </div>
          )}
          {/* Floating "New chat" (Flutter extended FAB); in <body> so no transformed ancestor traps it. */}
          {createPortal(
            <div data-m="page-actions">
              <Button onClick={() => setDialog('chat')}>
                <MessageSquarePlus aria-hidden /> {t('chat.new')}
              </Button>
            </div>,
            document.body,
          )}
          <div className="overflow-hidden rounded-[18px] border border-[#edf0f6] bg-white shadow-[0_6px_18px_rgba(49,46,129,0.06)]">
            {rows}
          </div>
        </div>
        {dialogs}
      </>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-112 overflow-hidden rounded-2xl border bg-card shadow-card">
      <aside className="flex w-80 shrink-0 flex-col border-r xl:w-88" aria-label={t('chat.title')}>
        <div className="bg-brand grid gap-3 px-4 pt-4 pb-3 text-white">
          <div className="flex items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <MessagesSquare className="size-5" aria-hidden />
              {t('chat.title')}
              {unread > 0 && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium tabular">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </h1>
            <div className="flex items-center gap-1.5">
              {isAdmin && (
                <HeaderButton onClick={() => setDialog('group')} icon={UsersRound}>
                  {t('chat.newGroup')}
                </HeaderButton>
              )}
              <HeaderButton onClick={() => setDialog('chat')} icon={MessageSquarePlus} solid>
                {t('chat.new')}
              </HeaderButton>
            </div>
          </div>
          {isAdmin && <ScopeSwitch scope={scope} onChange={setScope} />}
        </div>
        {rows}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {open ? (
          <ChatThread key={open.id} c={open} listHref={listHref} />
        ) : conversationId && waiting ? (
          <div className="grid flex-1 place-items-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center bg-muted/30 p-6 text-center">
            <div className="grid justify-items-center gap-3">
              <span className="flex size-14 items-center justify-center rounded-full bg-info-soft text-info-fg">
                <MessagesSquare className="size-7" aria-hidden />
              </span>
              <p className="max-w-xs text-sm text-muted-foreground">
                {conversationId ? t('chat.notFound') : t('chat.pick')}
              </p>
            </div>
          </div>
        )}
      </section>
      {dialogs}
    </div>
  )
}

function HeaderButton({
  onClick,
  icon: Icon,
  solid = false,
  children,
}: {
  onClick: () => void
  icon: typeof Users
  solid?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        solid
          ? 'bg-white text-primary hover:bg-white/90'
          : 'bg-white/15 text-white hover:bg-white/25',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

/** "My chats | All chats" for admins. */
function ScopeSwitch({
  scope,
  onChange,
  phone = false,
}: {
  scope: ChatListScope
  onChange: (s: ChatListScope) => void
  phone?: boolean
}) {
  const { t } = useTranslation()
  const options: Array<{ value: ChatListScope; label: string; icon: typeof Users }> = [
    { value: 'mine', label: t('chat.mine'), icon: MessagesSquare },
    { value: 'all', label: t('chat.all'), icon: Eye },
  ]
  return (
    <div
      role="group"
      aria-label={t('chat.scope')}
      className={cn(
        'grid grid-cols-2 gap-1 rounded-xl p-1',
        phone
          ? 'border border-[#edf0f6] bg-white shadow-[0_6px_18px_rgba(49,46,129,0.06)]'
          : 'bg-white/15',
      )}
    >
      {options.map((o) => {
        const active = o.value === scope
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors',
              phone ? 'h-10 text-sm' : 'h-8 text-xs',
              phone
                ? active
                  ? 'bg-[#eef2ff] text-[#4338ca]'
                  : 'text-[#64748b]'
                : active
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-white/85 hover:bg-white/10 hover:text-white',
              'focus-visible:outline-2 focus-visible:outline-offset-1',
              phone ? 'focus-visible:outline-ring' : 'focus-visible:outline-white',
            )}
          >
            <o.icon className="size-3.5" aria-hidden />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function ConversationList({
  list,
  scope,
  active,
  link,
  flat,
}: {
  list: ReturnType<typeof useConversations>
  scope: ChatListScope
  active: string | undefined
  link: (id: string) => string
  flat: boolean
}) {
  const { t } = useTranslation()
  if (list.isPending)
    return (
      <div className="grid gap-3 p-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="h-10 flex-1" />
          </div>
        ))}
      </div>
    )
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.data.length === 0)
    return (
      <div className="p-4">
        <EmptyState
          icon={MessagesSquare}
          title={scope === 'all' ? t('chat.noneAll') : t('chat.none')}
          description={scope === 'all' ? undefined : t('chat.noneHint')}
        />
      </div>
    )
  return (
    <ul className={cn(flat ? 'divide-y divide-[#edf0f6]' : 'flex-1 overflow-y-auto p-2')}>
      {list.data.map((c) => (
        <li key={c.id}>
          <ConversationRow c={c} active={!flat && c.id === active} to={link(c.id)} flat={flat} />
        </li>
      ))}
    </ul>
  )
}

function preview(c: ConversationListItem, me: string | null, t: TFunction) {
  const last = c.lastMessage
  if (!last) return t('chat.noMessages')
  const voice =
    last.voiceSec != null
      ? t('chat.voice.preview', { duration: formatVoiceDuration(last.voiceSec) })
      : ''
  const body = [voice, last.body].filter(Boolean).join(' · ')
  if (me && last.authorName === me) return `${t('chat.you')}: ${body}`
  if (c.type === 'GROUP' || c.viewOnly) return `${last.authorName.split(' ')[0]}: ${body}`
  return body
}

function ConversationRow({
  c,
  active,
  to,
  flat,
}: {
  c: ConversationListItem
  active: boolean
  to: string
  flat: boolean
}) {
  const { t } = useTranslation()
  const { me } = useChatRole()
  const hasUnread = c.unread > 0
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        flat ? 'm-press px-3.5 py-3' : 'rounded-xl px-2.5 py-2.5 hover:bg-muted/70',
        active && 'bg-info-soft hover:bg-info-soft',
      )}
    >
      <ConversationAvatar c={c} meId={me?.id} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm',
              hasUnread ? 'font-semibold text-foreground' : 'font-medium',
            )}
          >
            {c.title}
          </span>
          {c.viewOnly && (
            <Eye className="size-3.5 shrink-0 text-warning-fg" aria-label={t('chat.viewOnly')} />
          )}
          <span
            className={cn(
              'ml-auto shrink-0 text-[11px] tabular',
              hasUnread ? 'font-semibold text-primary' : 'text-muted-foreground',
            )}
          >
            {listTime(c.lastMessage?.createdAt ?? c.lastMessageAt, t)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-13',
              hasUnread ? 'text-foreground' : 'text-muted-foreground',
              !c.lastMessage && 'italic',
            )}
          >
            {preview(c, me ? fullName(me) : null, t)}
          </span>
          {hasUnread && (
            <span
              aria-label={t('chat.unread', { count: c.unread })}
              className="bg-brand flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular"
            >
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}

/** Top bar of an open chat (and of the phone "not found" screen). */
function ThreadBar({
  listHref,
  phone,
  children,
}: {
  listHref: string
  phone: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 border-b bg-card',
        phone ? 'm-chat-bar' : 'px-4 py-3',
      )}
    >
      {phone && (
        <Link to={listHref} className="m-icon-btn -ml-1" aria-label={t('chat.back')}>
          <ArrowLeft aria-hidden className="size-6" />
        </Link>
      )}
      {children}
    </header>
  )
}

interface Run {
  m: ChatMessageDto
  newDay: boolean
  first: boolean
}

function withRuns(messages: ChatMessageDto[]): Run[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1]
    const at = new Date(m.createdAt)
    const newDay = !prev || !isSameLocalDay(new Date(prev.createdAt), at)
    const first =
      newDay ||
      prev.author.id !== m.author.id ||
      at.getTime() - new Date(prev.createdAt).getTime() > RUN_GAP_MS
    return { m, newDay, first }
  })
}

function ChatThread({
  c,
  listHref,
  phone = false,
}: {
  c: ConversationListItem
  listHref: string
  phone?: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { me } = useChatRole()
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [voiceSending, setVoiceSending] = useState(false)
  const [micOk] = useState(canRecordVoice)
  const bottom = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id
  const viewOnly = c.viewOnly
  const isGroup = c.type === 'GROUP'

  const markRead = useCallback(async () => {
    // Overseeing admins leave no trace: no read marks, no unread changes.
    if (viewOnly) return
    try {
      await chatApi.read(c.id)
      void qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch {
      // Not critical: the next poll tries again.
    }
  }, [c.id, qc, viewOnly])

  useEffect(() => {
    const ctrl = new AbortController()
    chatApi
      .messages(c.id, {}, ctrl.signal)
      .then((p) => {
        setMessages(p.messages)
        setHasMore(p.hasMore)
        void markRead()
      })
      .catch((err) => !ctrl.signal.aborted && setError(err))
      .finally(() => !ctrl.signal.aborted && setLoading(false))
    return () => ctrl.abort()
  }, [c.id, markRead])

  // Poll for new messages while the chat is open.
  useEffect(() => {
    if (loading || error) return
    const timer = setInterval(() => {
      if (document.hidden) return
      void chatApi
        .messages(c.id, lastId ? { after: lastId } : {})
        .then((p) => {
          // An empty chat polls without a cursor: its latest page is all new.
          const fresh = p.messages
          if (fresh.length) {
            setMessages((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))])
            void markRead()
          }
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [c.id, lastId, loading, error, markRead])

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [lastId])

  async function older() {
    const first = messages[0]
    if (!first) return
    try {
      const p = await chatApi.messages(c.id, { before: first.id })
      setMessages((m) => [...p.messages, ...m])
      setHasMore(p.hasMore)
    } catch (err) {
      reportError(err, t)
    }
  }

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const msg = await chatApi.send(c.id, { body, workOrderId: '' })
      setMessages((m) => [...m, msg])
      setText('')
      void qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch (err) {
      reportError(err, t)
    } finally {
      setSending(false)
    }
  }

  async function sendVoice(clip: VoiceClip | null) {
    if (!clip) return
    setVoiceSending(true)
    try {
      const msg = await chatApi.sendVoice(c.id, clip.file, clip.durationSec)
      setMessages((m) => [...m, msg])
      void qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch (err) {
      reportError(err, t)
    } finally {
      setVoiceSending(false)
    }
  }
  // Stopped by itself at 3:00: send what was recorded.
  const voice = useVoiceRecorder((clip) => void sendVoice(clip))

  async function remove(m: ChatMessageDto) {
    try {
      await chatApi.remove(c.id, m.id)
      setMessages((list) =>
        list.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)),
      )
      // The chat list shows the last message as a preview; it must not keep the deleted text.
      void qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch (err) {
      reportError(err, t)
    }
  }

  async function leave() {
    try {
      await chatApi.leave(c.id)
      setMembersOpen(false)
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      navigate(listHref, { replace: true })
    } catch (err) {
      reportError(err, t)
    }
  }

  const other = c.members.find((m) => m.id !== me?.id)
  const subtitle =
    isGroup || viewOnly ? memberLine(c.members, me?.id, t, phone ? 3 : 5) : (other?.role ?? '')
  const showNames = isGroup || viewOnly
  const workLink = (id: string) =>
    listHref.startsWith('/w') ? `/w/tasks/${id}` : `/work-orders/${id}`

  return (
    <>
      <ThreadBar listHref={listHref} phone={phone}>
        <ConversationAvatar c={c} meId={me?.id} size={phone ? 38 : 42} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate font-semibold', phone ? 'text-[16px]' : 'text-[15px]')}>
              {c.title}
            </span>
            {viewOnly && !phone && <ViewOnlyTag t={t} />}
            {viewOnly && phone && (
              <Eye className="size-4 shrink-0 text-warning-fg" aria-label={t('chat.viewOnly')} />
            )}
          </span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {isGroup &&
          (phone ? (
            <button
              type="button"
              className="m-icon-btn"
              aria-label={t('chat.members')}
              onClick={() => setMembersOpen(true)}
            >
              <Users aria-hidden className="size-6" />
            </button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setMembersOpen(true)}>
                <Users aria-hidden /> {t('chat.members')}
                <span className="rounded-full bg-info-soft px-1.5 text-[11px] font-semibold text-info-fg tabular">
                  {c.members.length}
                </span>
              </Button>
              {!viewOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-danger-soft hover:text-danger-fg"
                  onClick={() => void leave()}
                >
                  <LogOut aria-hidden /> {t('chat.leave')}
                </Button>
              )}
            </>
          ))}
      </ThreadBar>
      <div
        className={cn('chat-wallpaper flex-1 overflow-y-auto', phone ? 'px-3 py-3' : 'px-5 py-4')}
        aria-live="polite"
      >
        {loading ? (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorState error={error} />
        ) : (
          <ol className="grid">
            {hasMore && (
              <li className="mb-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => void older()}>
                  {t('chat.older')}
                </Button>
              </li>
            )}
            {messages.length === 0 && (
              <li className="py-10 text-center text-sm text-muted-foreground">
                {viewOnly ? t('chat.noMessages') : t('chat.say')}
              </li>
            )}
            {withRuns(messages).map(({ m, newDay, first }) => (
              <Message
                key={m.id}
                m={m}
                newDay={newDay}
                first={first}
                showName={showNames}
                workLink={workLink}
                onDelete={viewOnly ? undefined : () => void remove(m)}
              />
            ))}
            <div ref={bottom} />
          </ol>
        )}
      </div>
      {viewOnly ? (
        <div
          role="note"
          className={cn(
            'flex shrink-0 items-center gap-3 border-t bg-warning-soft px-4 py-3 text-13 font-medium text-warning-fg',
            phone && 'm-chat-composer',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/80">
            <Eye className="size-4" aria-hidden />
          </span>
          {t('chat.viewOnlyBanner')}
        </div>
      ) : (
        <form
          className={cn(
            'flex shrink-0 items-end gap-2 border-t bg-card',
            phone ? 'm-chat-composer' : 'px-4 py-3',
          )}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {voice.recording || voiceSending ? (
            <RecordingBar
              seconds={voice.seconds}
              sending={voiceSending}
              onCancel={voice.cancel}
              onSend={() => void voice.finish().then(sendVoice)}
            />
          ) : (
            <>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !phone) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={1}
                maxLength={2000}
                aria-label={t('chat.message')}
                placeholder={t('chat.message')}
                className="max-h-32 min-h-11 resize-none rounded-2xl bg-muted/50 px-4 py-2.5"
              />
              {micOk && !text.trim() ? (
                <MicButton onClick={voice.start} busy={voice.starting} disabled={sending} />
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  loading={sending}
                  aria-label={t('chat.send')}
                  disabled={!text.trim()}
                  className="bg-brand size-11 shrink-0 rounded-full border-0 shadow-sm"
                >
                  <Send />
                </Button>
              )}
            </>
          )}
        </form>
      )}
      <MembersDialog
        c={c}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        onLeave={viewOnly ? undefined : () => void leave()}
      />
    </>
  )
}

function Message({
  m,
  newDay,
  first,
  showName,
  workLink,
  onDelete,
}: {
  m: ChatMessageDto
  newDay: boolean
  first: boolean
  showName: boolean
  workLink: (id: string) => string
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const color = personColor(m.author.id)
  const mine = m.mine
  return (
    <>
      {newDay && (
        <li className="my-3 flex items-center gap-3" aria-hidden={false}>
          <span className="h-px flex-1 bg-border" />
          <span className="rounded-full border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">
            {dayLabel(m.createdAt, t)}
          </span>
          <span className="h-px flex-1 bg-border" />
        </li>
      )}
      <li
        className={cn(
          'group flex items-start gap-2',
          mine ? 'justify-end' : 'justify-start',
          first ? 'mt-3' : 'mt-1',
        )}
      >
        {!mine && (
          <span className="w-8 shrink-0">
            {first && <PersonAvatar person={m.author} size={32} />}
          </span>
        )}
        {mine && onDelete && !m.deleted && (
          <button
            type="button"
            aria-label={t('chat.delete')}
            onClick={onDelete}
            className="mt-2 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-danger-soft hover:text-danger-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring [@media(hover:none)]:opacity-60"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
        <div
          className={cn(
            'max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[70%]',
            mine
              ? 'bg-brand shadow-sm'
              : 'border border-border/80 bg-card text-foreground shadow-xs',
            mine && first && 'rounded-tr-md',
            !mine && first && 'rounded-tl-md',
            m.deleted && 'opacity-70',
          )}
        >
          {!mine && first && showName && (
            <p className="mb-0.5 text-xs font-semibold" style={{ color }}>
              {fullName(m.author)}
            </p>
          )}
          {m.voice && !m.deleted && <VoicePlayer voice={m.voice} seed={m.id} mine={mine} />}
          {(m.deleted || m.body || !m.voice) && (
            <p className={cn('wrap-break-word whitespace-pre-wrap', m.deleted && 'italic')}>
              {m.deleted ? t('chat.deleted') : m.body}
            </p>
          )}
          {m.workOrder && (
            <Link
              to={workLink(m.workOrder.id)}
              className={cn(
                'mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium',
                mine
                  ? 'bg-white/15 text-white hover:bg-white/25'
                  : 'bg-info-soft text-info-fg hover:underline',
              )}
            >
              <ClipboardList className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                {m.workOrder.code} · {m.workOrder.title}
              </span>
            </Link>
          )}
          <p
            className={cn(
              'mt-0.5 text-right text-[11px] tabular',
              mine ? 'text-white/75' : 'text-muted-foreground',
            )}
          >
            <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
              {formatTime(m.createdAt)}
            </time>
          </p>
        </div>
      </li>
    </>
  )
}

export const AdminChatPage = () => <ChatPage base="/chat" />

export function WorkerChatPage() {
  const phone = usePhone()
  if (phone) return <ChatPage base="/w/chat" />
  return (
    <div className="px-3 py-3">
      <ChatPage base="/w/chat" />
    </div>
  )
}
