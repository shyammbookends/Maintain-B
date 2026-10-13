import { fullName, type WorkOrderCompletionReport } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { DetailList } from '@/components/common/DetailList'
import { formatDateTime, formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

/** The technician's repair report, read-only. */
export function CompletionSummary({ report: r }: { report: WorkOrderCompletionReport }) {
  const { t } = useTranslation()
  return (
    <DetailList
      items={[
        { label: t('completion.problemFound'), value: r.problemFound },
        { label: t('completion.rootCause'), value: r.rootCause },
        { label: t('completion.workPerformed'), value: r.workPerformed },
        {
          label: t('completion.finalCondition'),
          value: enumLabel(t, 'finalCondition', r.finalCondition),
        },
        {
          label: t('completion.partsLabel'),
          value: r.noPartsUsed ? t('completion.noPartsUsed') : null,
          hidden: !r.noPartsUsed,
        },
        { label: t('completion.newPartsInstalled'), value: r.newPartsInstalled },
        { label: t('completion.oldPartsRemoved'), value: r.oldPartsRemoved },
        {
          label: t('completion.quantityRepaired'),
          value: r.quantityRepaired,
          hidden: r.quantityRepaired === null,
        },
        {
          label: t('completion.quantityReplaced'),
          value: r.quantityReplaced,
          hidden: r.quantityReplaced === null,
        },
        { label: t('completion.additionalMaterials'), value: r.additionalMaterials },
        { label: t('completion.additionalIssue'), value: r.additionalIssue },
        { label: t('completion.recommendation'), value: r.recommendation },
        { label: t('completion.labourShort'), value: formatDuration(r.labourMinutes) },
        {
          label: t('completion.confirmedBy'),
          value: `${fullName(r.confirmedBy)} · ${formatDateTime(r.confirmedAt)}`,
        },
      ]}
    />
  )
}
