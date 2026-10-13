import { fullName, type AutomationDto, type AutomationRunStatus } from '@maintainx/shared'
import { useQueryClient } from '@tanstack/react-query'
import { History, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AutomationEditor } from '@/components/automations/AutomationEditor'
import { Can } from '@/components/common/Can'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Panel } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import {
  autoKeys,
  automationsApi,
  useAutomationLogs,
  useAutomations,
} from '@/services/automations.service'
import { reportError } from '@/utils/errors'
import { formatDateTime, formatRelative } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

const RUN_TONE: Record<AutomationRunStatus, BadgeTone> = {
  SUCCESS: 'success',
  SKIPPED: 'neutral',
  FAILED: 'danger',
}

/** IF / THEN rules: overdue → notify, meter → PM job, low stock → alert … */
export function AutomationsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const query = useAutomations()
  const [editing, setEditing] = useState<AutomationDto | 'new' | null>(null)
  const [logsFor, setLogsFor] = useState<AutomationDto | null>(null)
  const [removing, setRemoving] = useState<AutomationDto | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: autoKeys.all })

  async function toggle(a: AutomationDto, active: boolean) {
    try {
      await automationsApi.setActive(a.id, active)
      await refresh()
    } catch (err) {
      reportError(err, t)
    }
  }

  return (
    <>
      <PageHeader
        title={t('automations.title')}
        description={t('automations.subtitle')}
        actions={
          <Can permission="automations:create">
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> {t('automations.new')}
            </Button>
          </Can>
        }
      />
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={Zap}
          title={t('automations.emptyTitle')}
          description={t('automations.emptyBody')}
          action={
            <Can permission="automations:create">
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus aria-hidden /> {t('automations.new')}
              </Button>
            </Can>
          }
        />
      ) : (
        <Panel>
          <ul className="divide-y">
            {query.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    {!a.active && <Badge tone="neutral">{t('automations.off')}</Badge>}
                  </span>
                  <span className="block text-13 text-muted-foreground">
                    {t('automations.ifThen', {
                      trigger: enumLabel(t, 'automationTrigger', a.trigger),
                      actions: a.actions.map((x) => t(`automations.action_${x.type}`)).join(', '),
                    })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {a.restaurant?.name ?? t('automations.allRestaurants')} ·{' '}
                    {t('automations.runs', { count: a.runCount })}
                    {a.lastRunAt && ` · ${formatRelative(a.lastRunAt)}`} · {fullName(a.createdBy)}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {a.can.edit && (
                    <Switch
                      checked={a.active}
                      aria-label={t('automations.toggle', { name: a.name })}
                      onCheckedChange={(v) => void toggle(a, v)}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('automations.logs', { name: a.name })}
                    onClick={() => setLogsFor(a)}
                  >
                    <History />
                  </Button>
                  {a.can.edit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('automations.edit', { name: a.name })}
                      onClick={() => setEditing(a)}
                    >
                      <Pencil />
                    </Button>
                  )}
                  {a.can.delete && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('automations.remove', { name: a.name })}
                      onClick={() => setRemoving(a)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent aria-describedby={undefined} className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {editing === 'new' ? t('automations.new') : t('automations.editTitle')}
            </SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <AutomationEditor
                rule={editing === 'new' ? null : editing}
                onCancel={() => setEditing(null)}
                onDone={() => {
                  toast.success(t('automations.saved'))
                  setEditing(null)
                  void refresh()
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
      {logsFor && <LogsDialog rule={logsFor} onClose={() => setLogsFor(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        tone="destructive"
        title={t('automations.removeTitle', { name: removing?.name ?? '' })}
        description={t('automations.removeBody')}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          try {
            await automationsApi.archive(removing!.id)
            await refresh()
          } catch (err) {
            reportError(err, t)
            throw err
          }
        }}
      />
    </>
  )
}

function LogsDialog({ rule, onClose }: { rule: AutomationDto; onClose: () => void }) {
  const { t } = useTranslation()
  const logs = useAutomationLogs(rule.id)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('automations.logsTitle')}</DialogTitle>
          <DialogDescription>{rule.name}</DialogDescription>
        </DialogHeader>
        {logs.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} compact />
        ) : logs.data.length === 0 ? (
          <p className="text-13 text-muted-foreground">{t('automations.noRuns')}</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {logs.data.map((l) => (
              <li key={l.id} className="grid gap-0.5 py-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={RUN_TONE[l.status]}>{t(`automations.run_${l.status}`)}</Badge>
                  {formatDateTime(l.createdAt)}
                </span>
                {l.message && <span className="text-13">{l.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
