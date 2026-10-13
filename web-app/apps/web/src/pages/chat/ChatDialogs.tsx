import { fullName, type ConversationListItem } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut, Search, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { chatApi, chatKeys, useChatPeople } from '@/services/chat.service'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { GroupAvatar, PersonAvatar } from './chat-ui'
import { useChatRole } from './chat-utils'

/*
 * Chat dialogs: a direct chat, a new group (Super Admins and Admins), and a
 * group's members (add / remove for admins in the group).
 */

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <Search
        className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('chat.searchPeople')}
        aria-label={t('chat.searchPeople')}
        className="pl-8"
      />
    </div>
  )
}

/** Search + checkboxes. People in `exclude` (already in the group) are left out. */
function PeoplePicker({
  open,
  picked,
  onPickedChange,
  exclude = [],
}: {
  open: boolean
  picked: string[]
  onPickedChange: (ids: string[]) => void
  exclude?: string[]
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const term = useDebouncedValue(q.trim(), 250)
  const people = useChatPeople(term, open)
  const rows = (people.data ?? []).filter((p) => !exclude.includes(p.id))
  return (
    <div className="grid gap-2">
      <SearchBox value={q} onChange={setQ} />
      <ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-lg border p-1">
        {people.isPending ? (
          <li className="grid gap-1 p-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </li>
        ) : rows.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted-foreground">{t('chat.noPeople')}</li>
        ) : (
          rows.map((p) => {
            const id = `pick-${p.id}`
            const on = picked.includes(p.id)
            return (
              <li
                key={p.id}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
                  on && 'bg-info-soft hover:bg-info-soft',
                )}
              >
                <Checkbox
                  id={id}
                  checked={on}
                  onCheckedChange={(v) =>
                    onPickedChange(
                      v === true ? [...picked, p.id] : picked.filter((x) => x !== p.id),
                    )
                  }
                />
                <PersonAvatar person={p} size={30} />
                <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-normal">
                  <span className="block truncate">{fullName(p)}</span>
                  {p.role && (
                    <span className="block truncate text-xs text-muted-foreground">{p.role}</span>
                  )}
                </Label>
              </li>
            )
          })
        )}
      </ul>
      {picked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('chat.selected', { count: picked.length })}
        </p>
      )}
    </div>
  )
}

/** A one-to-one chat: tap a person. */
export function NewChatDialog({
  open,
  onOpenChange,
  link,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  link: (id: string) => string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const term = useDebouncedValue(q.trim(), 250)
  const people = useChatPeople(term, open)

  async function start(userId: string) {
    setBusy(userId)
    try {
      const { id } = await chatApi.start({ userIds: [userId], name: '' })
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      onOpenChange(false)
      navigate(link(id))
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.new')}</DialogTitle>
          <DialogDescription>{t('chat.newHint')}</DialogDescription>
        </DialogHeader>
        <SearchBox value={q} onChange={setQ} />
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
          {people.isPending ? (
            <li className="grid gap-1">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </li>
          ) : (people.data ?? []).length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">{t('chat.noPeople')}</li>
          ) : (
            people.data!.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void start(p.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                >
                  <PersonAvatar person={p} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{fullName(p)}</span>
                    {p.role && (
                      <span className="block truncate text-xs text-muted-foreground">{p.role}</span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** A named group (Super Admins and Admins). */
export function NewGroupDialog({
  open,
  onOpenChange,
  link,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  link: (id: string) => string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length >= 2 && picked.length > 0

  async function create() {
    if (!valid) return
    setBusy(true)
    try {
      const { id } = await chatApi.start({ userIds: picked, name: name.trim() })
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      onOpenChange(false)
      setPicked([])
      setName('')
      navigate(link(id))
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GroupAvatar size={28} /> {t('chat.newGroup')}
          </DialogTitle>
          <DialogDescription>{t('chat.newGroupHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="chat-group-name">{t('chat.groupName')}</Label>
            <Input
              id="chat-group-name"
              value={name}
              required
              minLength={2}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('chat.groupNameHint')}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t('chat.people')}</span>
            <PeoplePicker open={open} picked={picked} onPickedChange={setPicked} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={!valid}>
              {t('chat.createGroup')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Everyone in a group; admins in it add and remove people, members can leave. */
export function MembersDialog({
  c,
  open,
  onOpenChange,
  onLeave,
}: {
  c: ConversationListItem
  open: boolean
  onOpenChange: (o: boolean) => void
  onLeave?: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { me, isAdmin, isSuperAdmin } = useChatRole()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const manage = isAdmin && !c.viewOnly && c.type === 'GROUP'

  async function add() {
    setBusy('add')
    try {
      await chatApi.addMembers(c.id, picked)
      await qc.invalidateQueries({ queryKey: chatKeys.list })
      setPicked([])
      setAdding(false)
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  async function remove(userId: string) {
    setBusy(userId)
    try {
      await chatApi.removeMember(c.id, userId)
      await qc.invalidateQueries({ queryKey: chatKeys.list })
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(null)
    }
  }

  const members = [...c.members].sort((a, b) =>
    a.id === me?.id ? -1 : b.id === me?.id ? 1 : fullName(a).localeCompare(fullName(b)),
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setAdding(false)
          setPicked([])
        }
      }}
    >
      <DialogContent
        data-m="chat-members"
        className="gap-0 overflow-hidden p-0 sm:max-w-md [&>button:last-child]:text-white [&>button:last-child]:hover:bg-white/15 [&>button:last-child]:hover:text-white"
      >
        <DialogHeader className="bg-brand px-5 py-4 text-left text-white">
          <DialogTitle className="flex items-center gap-2 text-white">
            {adding && (
              <button
                type="button"
                onClick={() => setAdding(false)}
                aria-label={t('actions.back')}
                className="-ml-1 rounded-md p-1 hover:bg-white/15"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            )}
            {!adding && <Users className="size-4" aria-hidden />}
            {adding ? t('chat.addMembers') : t('chat.members')}
            {!adding && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium tabular">
                {c.members.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="truncate text-white/80">{c.title}</DialogDescription>
        </DialogHeader>
        {adding ? (
          <div className="grid gap-4 p-5">
            <PeoplePicker
              open={open && adding}
              picked={picked}
              onPickedChange={setPicked}
              exclude={c.members.map((m) => m.id)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {t('actions.cancel')}
              </Button>
              <Button
                loading={busy === 'add'}
                disabled={picked.length === 0}
                onClick={() => void add()}
              >
                <UserPlus aria-hidden /> {t('chat.add')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ul className="max-h-[50vh] divide-y overflow-y-auto">
              {members.map((m) => {
                const self = m.id === me?.id
                // Admins can't remove a Super Admin (the server says so too).
                const removable = manage && !self && (isSuperAdmin || m.role !== 'Super Admin')
                return (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                    <PersonAvatar person={m} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {fullName(m)}
                        {self && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({t('chat.you')})
                          </span>
                        )}
                      </span>
                      {m.role && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.role}
                        </span>
                      )}
                    </span>
                    {removable && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        loading={busy === m.id}
                        disabled={busy !== null}
                        aria-label={t('chat.remove', { name: fullName(m) })}
                        title={t('chat.remove', { name: fullName(m) })}
                        className="text-muted-foreground hover:bg-danger-soft hover:text-danger-fg"
                        onClick={() => void remove(m.id)}
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {(manage || (onLeave && !c.viewOnly)) && (
              <div className="flex flex-wrap justify-between gap-2 border-t bg-muted/40 px-5 py-3">
                {onLeave && !c.viewOnly ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg"
                    onClick={onLeave}
                  >
                    <LogOut aria-hidden /> {t('chat.leave')}
                  </Button>
                ) : (
                  <span />
                )}
                {manage && (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <UserPlus aria-hidden /> {t('chat.addMembers')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
