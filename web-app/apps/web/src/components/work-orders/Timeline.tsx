import {
  fullName,
  type MessageInput,
  type WorkOrderEvent,
  type WorkOrderMessage,
} from '@maintainx/shared'
import { AtSign, Lock, Paperclip, Reply, Send, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useQuery } from '@tanstack/react-query'
import { workOrdersApi } from '@/services/work-orders.service'
import { cn } from '@/utils/cn'
import { isQueuedOffline, reportError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { AttachmentGallery } from './Attachments'

interface Props {
  messages: WorkOrderMessage[]
  canSend: boolean
  /** Managers may post internal notes (hidden from technicians). */
  canInternal?: boolean
  /** Work order whose people can be @mentioned. */
  workOrderId?: string
  send: (input: MessageInput, files?: File[]) => Promise<unknown>
}

/**
 * Conversation on a work order: replies are shown under the message they
 * answer, internal notes are marked, @mentioned people are notified, and
 * photos or files can go with a message.
 */
export function MessagesPanel({
  messages,
  canSend,
  canInternal = false,
  workOrderId,
  send,
}: Props) {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [internal, setInternal] = useState(false)
  const [replyTo, setReplyTo] = useState<WorkOrderMessage | null>(null)
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([])
  const [files, setFiles] = useState<File[]>([])
  const [mentioning, setMentioning] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const people = useQuery({
    queryKey: ['work-orders', 'people', workOrderId],
    queryFn: ({ signal }) => workOrdersApi.people(workOrderId!, signal),
    enabled: canSend && mentioning && !!workOrderId,
    staleTime: 60_000,
  })

  const roots = messages.filter((m) => !m.parentId || !messages.some((p) => p.id === m.parentId))
  const repliesTo = (id: string) => messages.filter((m) => m.parentId === id)

  function reset() {
    setBody('')
    setReplyTo(null)
    setMentions([])
    setFiles([])
    setInternal(false)
  }

  async function submit() {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      await send(
        {
          body: text,
          ...(replyTo ? { parentId: replyTo.id } : {}),
          ...(internal ? { internal: true } : {}),
          ...(mentions.length ? { mentionIds: mentions.map((m) => m.id) } : {}),
        },
        files,
      )
      reset()
    } catch (err) {
      reportError(err, t)
      // Kept on the device for later: the composer is done with it.
      if (isQueuedOffline(err)) reset()
    } finally {
      setBusy(false)
    }
  }

  function mention(id: string) {
    const u = people.data?.find((p) => p.id === id)
    if (!u || mentions.some((m) => m.id === id)) return
    const name = fullName(u)
    setMentions((m) => [...m, { id, name }])
    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${name} `)
    setMentioning(false)
  }

  const bubble = (m: WorkOrderMessage, nested = false) => (
    <li
      key={m.id}
      className={cn(
        'grid max-w-[85%] gap-1 rounded-lg px-3 py-2 text-sm',
        m.internal
          ? 'justify-self-stretch border border-dashed border-warning bg-warning-soft max-w-full'
          : m.mine
            ? 'justify-self-end bg-info-soft'
            : 'justify-self-start bg-muted',
        nested && 'ml-6',
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {m.internal && (
          <Badge tone="warning" className="gap-1">
            <Lock className="size-3" aria-hidden /> {t('messages.internal')}
          </Badge>
        )}
        {m.mine ? t('wo.you') : fullName(m.author)} · {formatDateTime(m.createdAt)}
      </span>
      <p className="whitespace-pre-wrap wrap-break-word">{m.body}</p>
      {m.mentions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('messages.mentioned', { names: m.mentions.map(fullName).join(', ') })}
        </p>
      )}
      <AttachmentGallery items={m.attachments} />
      {canSend && !nested && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start px-1"
          onClick={() => {
            setReplyTo(m)
            if (m.internal && canInternal) setInternal(true)
          }}
        >
          <Reply aria-hidden /> {t('messages.reply')}
        </Button>
      )}
    </li>
  )

  return (
    <div className="grid gap-3">
      {messages.length === 0 ? (
        <p className="text-13 text-muted-foreground">{t('wo.noMessages')}</p>
      ) : (
        <ul className="grid gap-2">
          {roots.map((m) => [bubble(m), ...repliesTo(m.id).map((r) => bubble(r, true))])}
        </ul>
      )}
      {canSend && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {replyTo && (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
              <Reply className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {t('messages.replyingTo', { name: fullName(replyTo.author) })}: {replyTo.body}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('messages.cancelReply')}
                onClick={() => setReplyTo(null)}
              >
                <X />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={t('wo.messageLabel')}
              placeholder={t('wo.messagePlaceholder')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              maxLength={2000}
              className="min-h-11"
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label={t('wo.send')}
              loading={busy}
              disabled={!body.trim()}
            >
              <Send />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workOrderId &&
              (mentioning ? (
                <Select onValueChange={mention}>
                  <SelectTrigger className="h-9 w-56" aria-label={t('messages.mentionSomeone')}>
                    <SelectValue placeholder={t('messages.mentionSomeone')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(people.data ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {fullName(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setMentioning(true)}>
                  <AtSign aria-hidden /> {t('messages.mention')}
                </Button>
              ))}
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
              <Paperclip aria-hidden /> {t('messages.attach')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,application/pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="message-files"
              onChange={(e) => {
                setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5))
                e.target.value = ''
              }}
            />
            {canInternal && (
              <label className="flex items-center gap-2 text-13">
                <Checkbox checked={internal} onCheckedChange={(c) => setInternal(c === true)} />
                <Lock className="size-3.5 text-muted-foreground" aria-hidden />
                {t('messages.internalToggle')}
              </label>
            )}
          </div>
          {(mentions.length > 0 || files.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {mentions.map((m) => (
                <Badge key={m.id} tone="info" className="gap-1">
                  @{m.name}
                  <button
                    type="button"
                    aria-label={t('messages.removeMention', { name: m.name })}
                    onClick={() => setMentions((x) => x.filter((y) => y.id !== m.id))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              {files.map((f, i) => (
                <Badge key={`${f.name}-${i}`} tone="outline" className="gap-1">
                  <Paperclip className="size-3" aria-hidden /> {f.name}
                  <button
                    type="button"
                    aria-label={t('messages.removeFile', { name: f.name })}
                    onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

/** Status changes, newest first. */
export function HistoryList({ events }: { events: WorkOrderEvent[] }) {
  const { t } = useTranslation()
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <ol className="grid gap-3">
      {sorted.map((e) => (
        <li key={e.id} className="grid gap-1 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="workOrderStatus" value={e.toStatus} />
            <span className="text-xs text-muted-foreground">
              {e.actor ? fullName(e.actor) : t('wo.system')} · {formatDateTime(e.createdAt)}
            </span>
          </div>
          {e.note && <p className="text-13 whitespace-pre-wrap text-foreground/90">{e.note}</p>}
        </li>
      ))}
    </ol>
  )
}
