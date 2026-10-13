import { simpleStatusOf, type SimpleStatus } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { useWorkflow } from '@/contexts/WorkflowContext'
import { enumLabel } from '@/utils/i18n'
import { statusTone, type StatusKind, type StatusValueMap } from '@/utils/status'

interface StatusBadgeProps<K extends StatusKind> {
  kind: K
  value: StatusValueMap[K]
  className?: string
}

const SIMPLE_TONE: Record<SimpleStatus, BadgeTone> = {
  OPEN: 'neutral',
  ON_HOLD: 'warning',
  IN_PROGRESS: 'info',
  REVIEW: 'review',
  DONE: 'success',
  CANCELLED: 'outline',
}

/**
 * The only way statuses and priorities are shown. Colour comes from
 * utils/status.ts; label is translated. The dot keeps meaning legible for
 * colour-blind users alongside the text. With the "simple statuses" setting,
 * work order stages fold into Open / On hold / In progress / Done
 * (plus Awaiting approval when verification is on).
 *
 *   <StatusBadge kind="workOrderStatus" value="IN_PROGRESS" />
 *   <StatusBadge kind="priority" value="CRITICAL" />
 */
export function StatusBadge<K extends StatusKind>({ kind, value, className }: StatusBadgeProps<K>) {
  const { t } = useTranslation()
  const workflow = useWorkflow()
  if (kind === 'workOrderStatus' && workflow?.simpleStatuses) {
    const simple = simpleStatusOf(value as StatusValueMap['workOrderStatus'])
    return (
      <Badge tone={SIMPLE_TONE[simple]} dot className={className}>
        {enumLabel(t, 'simpleStatus', simple)}
      </Badge>
    )
  }
  return (
    <Badge tone={statusTone(kind, value)} dot className={className}>
      {enumLabel(t, kind, value)}
    </Badge>
  )
}
