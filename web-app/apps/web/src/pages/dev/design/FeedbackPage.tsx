import { CheckCheck, Package, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Callout } from '@/components/common/Callout'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toaster'
import { ApiError } from '@/services/http'
import { Row, Section } from './Section'

const SAMPLE_ERROR = new ApiError(
  503,
  'SERVICE_UNAVAILABLE',
  'Service unavailable',
  undefined,
  'c0ffee12-ab34',
)

export function FeedbackPage() {
  const { t } = useTranslation()

  return (
    <>
      <PageHeader
        title="Feedback & states"
        description="Every screen has four states: loading, empty, error and content. Toasts confirm; callouts explain; errors never show technical details."
      />
      <div className="grid gap-6">
        <Section title="Empty states" bodyClassName="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border">
            <EmptyState
              icon={CheckCheck}
              title={t('empty.allCaughtUp')}
              description={t('empty.noTasksToday')}
            />
          </div>
          <div className="rounded-md border">
            <EmptyState
              icon={Package}
              title="No spare parts yet"
              description="Add the parts you keep in stock so workers can record what they use."
              action={
                <Button size="sm">
                  <Plus /> Add part
                </Button>
              }
            />
          </div>
        </Section>

        <Section
          title="Error state"
          note="Message comes from the error code (translated). The reference matches the server log."
        >
          <div className="rounded-md border">
            <ErrorState error={SAMPLE_ERROR} onRetry={() => toast('Retrying…')} />
          </div>
        </Section>

        <Section title="Loading" bodyClassName="grid gap-6 lg:grid-cols-2">
          <div className="grid gap-3 rounded-md border p-4" aria-busy="true">
            <span className="sr-only">{t('common.loading')}</span>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
          <div className="grid content-start gap-3">
            <Row>
              <Spinner label={t('common.loading')} />
              <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
            </Row>
            <Row>
              <Button loading>Saving</Button>
              <Button variant="secondary" loading>
                Uploading photo
              </Button>
            </Row>
            <p className="text-13 text-muted-foreground">
              Skeletons mirror the final layout so the page doesn’t jump when data arrives.
            </p>
          </div>
        </Section>

        <Section title="Callouts">
          <Callout tone="info" title="Preventive maintenance">
            This schedule creates a work order every Monday at 9:00 am.
          </Callout>
          <Callout tone="warning" title="Warranty ends in 21 days">
            Book the last free service with the vendor before 23 Oct.
          </Callout>
          <Callout tone="danger" title="Stock below minimum">
            Only 1 compressor relay left (minimum 3).
          </Callout>
          <Callout tone="success">Inventory updated after receiving PO-000045.</Callout>
        </Section>

        <Section
          title="Toasts"
          note="Short confirmations after an action. Max 3 visible, auto-dismiss in 4s."
        >
          <Row>
            <Button variant="secondary" onClick={() => toast.success(t('feedback.saved'))}>
              Success
            </Button>
            <Button variant="secondary" onClick={() => toast.error(t('errors.NETWORK_ERROR'))}>
              Error
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast('Work order assigned to Ramesh K.', {
                  action: { label: 'Undo', onClick: () => toast('Assignment undone') },
                })
              }
            >
              With action
            </Button>
          </Row>
        </Section>
      </div>
    </>
  )
}
