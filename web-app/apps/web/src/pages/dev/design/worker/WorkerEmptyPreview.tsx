import { Bell, CalendarDays, Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'

/** Gallery: the remaining worker tabs, showing the empty-state pattern. */
export function WorkerEmptyPreview() {
  const { t } = useTranslation()
  const { section } = useParams()

  const content =
    section === 'schedule'
      ? { title: t('nav.schedule'), icon: CalendarDays, empty: 'Nothing scheduled this week.' }
      : section === 'notifications'
        ? { title: t('nav.notifications'), icon: Bell, empty: t('empty.allCaughtUp') }
        : {
            title: t('nav.more'),
            icon: Menu,
            empty: 'Restaurants, assets, checklists and profile live here.',
          }

  return (
    <>
      <WorkerPageHeader title={content.title} />
      <EmptyState
        icon={content.icon}
        title={content.empty}
        description="Built in Phase 6 (Worker)."
      />
    </>
  )
}
