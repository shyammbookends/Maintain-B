import { useTranslation } from 'react-i18next'
import { Callout } from '@/components/common/Callout'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useHealth, useReadiness } from '@/hooks/useSystemStatus'
import { BrandMark } from '@/layouts/BrandMark'
import { ApiError } from '@/services/http'
import { formatNumber } from '@/utils/format'

type CheckState = 'up' | 'down' | 'checking'

const STATE_TONE: Record<CheckState, BadgeTone> = {
  up: 'success',
  down: 'danger',
  checking: 'neutral',
}

function CheckRow({
  label,
  state,
  details,
}: {
  label: string
  state: CheckState
  details: Array<{ label: string; value: string }>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {details.length > 0 && (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {details.map((d) => (
              <div key={d.label} className="flex gap-1">
                <dt>{d.label}:</dt>
                <dd className="font-medium text-foreground/80 tabular">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <Badge
        tone={STATE_TONE[state]}
        dot
        className={state === 'checking' ? 'animate-pulse' : undefined}
      >
        {t(`status.${state}`)}
      </Badge>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-4 py-3.5" aria-hidden>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-12" />
    </div>
  )
}

export function SystemStatusPage() {
  const { t } = useTranslation()
  const health = useHealth()
  const readiness = useReadiness()

  const apiState: CheckState = health.isPending ? 'checking' : health.isError ? 'down' : 'up'
  const dbState: CheckState =
    apiState === 'down'
      ? 'down'
      : readiness.isPending
        ? 'checking'
        : readiness.isError
          ? 'down'
          : readiness.data.checks.database.status

  const apiUnreachable =
    health.isError && health.error instanceof ApiError && health.error.status === 0
  const dbUnreachable = apiState === 'up' && dbState === 'down'
  const allGood = apiState === 'up' && dbState === 'up'
  const isInitialLoad = health.isPending && readiness.isPending

  const apiDetails = health.data
    ? [
        { label: t('status.version'), value: health.data.version },
        { label: t('status.environment'), value: health.data.environment },
        {
          label: t('status.uptime'),
          value: t('status.uptimeValue', {
            hours: Math.floor(health.data.uptimeSeconds / 3600),
            minutes: Math.floor((health.data.uptimeSeconds % 3600) / 60),
          }),
        },
      ]
    : []

  const dbDetails =
    readiness.data && readiness.data.checks.database.status === 'up'
      ? [
          {
            label: t('status.latency'),
            value: `${formatNumber(readiness.data.checks.database.latencyMs)} ms`,
          },
        ]
      : []

  const lastChecked = health.dataUpdatedAt || health.errorUpdatedAt
  const refreshing = health.isFetching || readiness.isFetching

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <BrandMark />
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-xl font-semibold tracking-tight">{t('status.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('status.subtitle')}</p>

        <Panel aria-busy={isInitialLoad} className="mt-6 divide-y">
          {isInitialLoad ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            <>
              <CheckRow label={t('status.api')} state={apiState} details={apiDetails} />
              <CheckRow label={t('status.database')} state={dbState} details={dbDetails} />
            </>
          )}
        </Panel>

        <div className="mt-3 grid gap-3">
          {allGood && <Callout tone="success">{t('status.allGood')}</Callout>}
          {apiUnreachable && (
            <Callout tone="danger" role="alert">
              {t('status.apiUnreachable')}
            </Callout>
          )}
          {dbUnreachable && (
            <Callout tone="warning" role="alert">
              {t('status.dbUnreachable')}
            </Callout>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {lastChecked
              ? t('status.lastChecked', {
                  time: new Date(lastChecked).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                })
              : ''}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void health.refetch()
              void readiness.refetch()
            }}
            disabled={refreshing}
          >
            {refreshing ? t('status.checking') : t('common.refresh')}
          </Button>
        </div>
      </main>
    </div>
  )
}
