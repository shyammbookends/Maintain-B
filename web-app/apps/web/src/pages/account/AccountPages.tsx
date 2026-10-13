import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/common/PageHeader'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { AccountView } from './AccountView'

export function AdminAccountPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('account.title')} />
      <AccountView />
    </>
  )
}

export function WorkerAccountPage() {
  const { t } = useTranslation()
  return (
    <>
      <WorkerPageHeader title={t('nav.profile')} backTo="/w/more" />
      <AccountView compact />
    </>
  )
}
