import {
  API_KEY_PRESETS,
  WEBHOOK_EVENTS,
  fullName,
  type ApiKeyDto,
  type ApiResponse,
  type CreatedApiKey,
  type CreatedWebhook,
  type DeliveryStatus,
  type Permission,
  type SsoProvider,
  type WebhookDto,
  type WebhookEvent,
} from '@maintainx/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Copy, KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { Badge } from '@/components/ui/badge'
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
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { http } from '@/services/http'
import { describeError, reportError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { looseT } from '@/utils/i18n'

const keys = {
  apiKeys: ['api-keys'] as const,
  webhooks: ['webhooks'] as const,
  delivery: ['notifications', 'delivery'] as const,
  sso: ['auth', 'sso-providers'] as const,
}

async function copy(text: string, ok: string, fail: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(ok)
  } catch {
    toast.error(fail)
  }
}

/** Notifications, sign-in, API keys and webhooks in one tab. */
export function IntegrationsPanels() {
  return (
    <div className="grid max-w-3xl gap-4">
      <StatusPanel />
      <ApiKeysPanel />
      <WebhooksPanel />
    </div>
  )
}

// ---------------------------------------------------------------- status

function StatusPanel() {
  const { t } = useTranslation()
  const delivery = useQuery({
    queryKey: keys.delivery,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<DeliveryStatus>>('/notifications/delivery', { signal }).then((r) => r.data),
  })
  const sso = useQuery({
    queryKey: keys.sso,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<SsoProvider[]>>('/auth/sso/providers', { signal }).then((r) => r.data),
  })
  const row = (label: string, on: boolean | undefined, hint: string) => (
    <li className="flex items-start justify-between gap-3 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      {on === undefined ? (
        <Skeleton className="h-5 w-12" />
      ) : (
        <Badge tone={on ? 'success' : 'neutral'} dot>
          {on ? t('integrations.on') : t('integrations.off')}
        </Badge>
      )}
    </li>
  )
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" aria-hidden /> {t('integrations.statusTitle')}
        </PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ul className="divide-y">
          {row(t('integrations.email'), delivery.data?.email, t('integrations.emailHint'))}
          {row(t('integrations.push'), delivery.data?.push, t('integrations.pushHint'))}
          {row(t('integrations.google'), sso.data?.includes('google'), t('integrations.ssoHint'))}
          {row(t('integrations.microsoft'), sso.data?.includes('microsoft'), t('integrations.ssoHint'))}
        </ul>
      </PanelBody>
    </Panel>
  )
}

// ---------------------------------------------------------------- API keys

function ApiKeysPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: keys.apiKeys,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<ApiKeyDto[]>>('/api-keys', { signal }).then((r) => r.data),
  })
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null)
  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden /> {t('apiKeys.title')}
        </PanelTitle>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> {t('apiKeys.create')}
        </Button>
      </PanelHeader>
      <PanelBody>
        <p className="mb-3 text-13 text-muted-foreground">{t('apiKeys.hint')}</p>
        {query.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <p className="text-13 text-muted-foreground">{t('apiKeys.none')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {query.data.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {k.name} <code className="ml-1 text-xs text-muted-foreground">{k.prefix}…</code>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t('apiKeys.meta', {
                      who: fullName(k.createdBy),
                      count: k.scopes.length,
                      used: k.lastUsedAt ? formatDateTime(k.lastUsedAt) : t('apiKeys.never'),
                    })}
                  </span>
                </span>
                {k.revokedAt ? (
                  <Badge tone="outline">{t('apiKeys.revoked')}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('apiKeys.revokeNamed', { name: k.name })}
                    onClick={() => setRevoking(k)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('apiKeys.create')}</DialogTitle>
            <DialogDescription>{t('apiKeys.createHint')}</DialogDescription>
          </DialogHeader>
          {creating && (
            <CreateKeyForm
              onDone={() => {
                void qc.invalidateQueries({ queryKey: keys.apiKeys })
              }}
              onClose={() => setCreating(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        tone="destructive"
        title={t('apiKeys.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('apiKeys.revokeBody')}
        confirmLabel={t('apiKeys.revoke')}
        onConfirm={async () => {
          try {
            const res = await http.delete<ApiResponse<ApiKeyDto[]>>(`/api-keys/${revoking!.id}`)
            qc.setQueryData(keys.apiKeys, res.data)
            toast.success(t('apiKeys.revokedToast'))
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

function CreateKeyForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<keyof typeof API_KEY_PRESETS>('readOnly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await http.post<ApiResponse<CreatedApiKey>>('/api-keys', {
        name: name.trim(),
        scopes: API_KEY_PRESETS[preset] as Permission[],
        expiresInDays: 365,
      })
      setCreated(res.data)
      onDone()
    } catch (err) {
      setError(describeError(err, t))
    } finally {
      setBusy(false)
    }
  }

  if (created)
    return (
      <div className="grid gap-3">
        <p className="text-sm font-medium text-warning-fg">{t('apiKeys.copyNow')}</p>
        <code className="rounded-md bg-muted p-2 text-xs break-all">{created.key}</code>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void copy(created.key, t('portal.copied'), t('portal.copyFailed'))}
          >
            <Copy aria-hidden /> {t('portal.copy')}
          </Button>
          <Button onClick={onClose}>{t('apiKeys.done')}</Button>
        </div>
      </div>
    )

  return (
    <div className="grid gap-4">
      {error && <p className="text-13 text-danger-fg">{error}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="api-key-name">{t('apiKeys.name')}</Label>
        <Input
          id="api-key-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('apiKeys.namePlaceholder')}
        />
      </div>
      <RadioGroup value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
        {(Object.keys(API_KEY_PRESETS) as Array<keyof typeof API_KEY_PRESETS>).map((p) => (
          <div key={p} className="flex items-start gap-2">
            <RadioGroupItem id={`preset-${p}`} value={p} className="mt-0.5" />
            <Label htmlFor={`preset-${p}`} className="grid gap-0.5 font-normal">
              <span className="font-medium">{t(`apiKeys.preset_${p}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`apiKeys.preset_${p}Hint`)}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button loading={busy} disabled={name.trim().length < 2} onClick={() => void submit()}>
          {t('apiKeys.create')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- webhooks

function WebhooksPanel() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: keys.webhooks,
    queryFn: ({ signal }) =>
      http.get<ApiResponse<WebhookDto[]>>('/webhooks', { signal }).then((r) => r.data),
  })
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<WebhookDto | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  async function test(h: WebhookDto) {
    setTesting(h.id)
    try {
      const res = await http.post<
        ApiResponse<{ ok: boolean; status: number | null; error: string | null; webhooks: WebhookDto[] }>
      >(`/webhooks/${h.id}/test`)
      qc.setQueryData(keys.webhooks, res.data.webhooks)
      if (res.data.ok) toast.success(t('webhooks.testOk', { status: res.data.status }))
      else toast.error(t('webhooks.testFailed', { reason: res.data.error ?? '' }))
    } catch (err) {
      reportError(err, t)
    } finally {
      setTesting(null)
    }
  }

  return (
    <Panel>
      <PanelHeader className="flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Webhook className="size-4 text-muted-foreground" aria-hidden /> {t('webhooks.title')}
        </PanelTitle>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden /> {t('webhooks.add')}
        </Button>
      </PanelHeader>
      <PanelBody>
        <p className="mb-3 text-13 text-muted-foreground">{t('webhooks.hint')}</p>
        {query.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <p className="text-13 text-muted-foreground">{t('webhooks.none')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {query.data.map((h) => (
              <li key={h.id} className="grid gap-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{h.url}</code>
                  <Badge tone={!h.active ? 'outline' : h.lastError ? 'warning' : 'success'} dot>
                    {!h.active
                      ? t('integrations.off')
                      : h.lastError
                        ? t('webhooks.failing')
                        : t('integrations.on')}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={testing === h.id}
                    onClick={() => void test(h)}
                  >
                    <Send aria-hidden /> {t('webhooks.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('webhooks.removeNamed', { url: h.url })}
                    onClick={() => setRemoving(h)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {h.events.map((e) => looseT(t)(`webhooks.event_${e.replace('.', '_')}`)).join(' · ')}
                  {h.lastSentAt && ` — ${t('webhooks.lastSent', { time: formatDateTime(h.lastSentAt) })}`}
                  {h.lastError && ` (${h.lastError})`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('webhooks.add')}</DialogTitle>
            <DialogDescription>{t('webhooks.addHint')}</DialogDescription>
          </DialogHeader>
          {adding && (
            <WebhookForm
              onDone={() => void qc.invalidateQueries({ queryKey: keys.webhooks })}
              onClose={() => setAdding(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('webhooks.removeTitle')}
        description={removing?.url ?? ''}
        confirmLabel={t('custom.remove')}
        onConfirm={async () => {
          try {
            const res = await http.delete<ApiResponse<WebhookDto[]>>(`/webhooks/${removing!.id}`)
            qc.setQueryData(keys.webhooks, res.data)
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </Panel>
  )
}

function WebhookForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('https://')
  const [events, setEvents] = useState<WebhookEvent[]>(['work_order.created', 'work_order.completed'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedWebhook | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await http.post<ApiResponse<CreatedWebhook>>('/webhooks', {
        url: url.trim(),
        events,
        active: true,
      })
      setCreated(res.data)
      onDone()
    } catch (err) {
      setError(describeError(err, t))
    } finally {
      setBusy(false)
    }
  }

  if (created)
    return (
      <div className="grid gap-3">
        <p className="text-sm">{t('webhooks.secretNow')}</p>
        <code className="rounded-md bg-muted p-2 text-xs break-all">{created.secret}</code>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void copy(created.secret, t('portal.copied'), t('portal.copyFailed'))}
          >
            <Copy aria-hidden /> {t('portal.copy')}
          </Button>
          <Button onClick={onClose}>{t('apiKeys.done')}</Button>
        </div>
      </div>
    )

  return (
    <div className="grid gap-4">
      {error && <p className="text-13 text-danger-fg">{error}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="webhook-url">{t('webhooks.url')}</Label>
        <Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('webhooks.events')}</legend>
        {WEBHOOK_EVENTS.map((e) => {
          const id = `event-${e}`
          return (
            <div key={e} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={events.includes(e)}
                onCheckedChange={(v) =>
                  setEvents((list) => (v === true ? [...list, e] : list.filter((x) => x !== e)))
                }
              />
              <Label htmlFor={id} className="font-normal">
                {looseT(t)(`webhooks.event_${e.replace('.', '_')}`)}
              </Label>
            </div>
          )
        })}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button
          loading={busy}
          disabled={!url.startsWith('https://') || events.length === 0}
          onClick={() => void submit()}
        >
          {t('webhooks.add')}
        </Button>
      </div>
    </div>
  )
}
