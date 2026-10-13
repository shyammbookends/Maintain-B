import { warrantyState, type WarrantyState } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { enumLabel } from '@/utils/i18n'

const TONE: Record<WarrantyState, BadgeTone> = {
  none: 'neutral',
  active: 'success',
  expiring: 'warning',
  expired: 'outline',
}

export function WarrantyBadge({ warrantyEnd }: { warrantyEnd: string | null }) {
  const { t } = useTranslation()
  const state = warrantyState(warrantyEnd)
  return (
    <Badge tone={TONE[state]} dot>
      {enumLabel(t, 'warranty', state)}
    </Badge>
  )
}
