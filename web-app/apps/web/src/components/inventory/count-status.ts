import type { StockCountStatus } from '@maintainx/shared'
import type { BadgeTone } from '@/components/ui/badge'

/** Badge colour for a stock count's status (always shown with its label). */
export const COUNT_TONE: Record<StockCountStatus, BadgeTone> = {
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
}
