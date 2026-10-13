import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Callout } from '@/components/common/Callout'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { parseAppQr } from '@/utils/qr'

export function WorkerScanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [problem, setProblem] = useState<'notOurs' | 'camera' | null>(null)
  const [opening, setOpening] = useState(false)

  const onScan = (codes: IDetectedBarcode[]) => {
    for (const code of codes) {
      const hit = parseAppQr(code.rawValue)
      if (hit) {
        setOpening(true)
        navigate(
          `/${hit.kind === 'asset' ? 'a' : hit.kind === 'location' ? 'l' : 'p'}/${hit.publicId}`,
        )
        return
      }
    }
    setProblem('notOurs')
  }

  return (
    <>
      <WorkerPageHeader title={t('qr.scanTitle')} />
      <div className="grid gap-4 px-4 py-4">
        <p className="text-sm text-muted-foreground">{t('qr.scanHint')}</p>
        {problem === 'camera' ? (
          <Callout tone="warning">{t('qr.cameraError')}</Callout>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-black">
            <Scanner
              onScan={onScan}
              onError={() => setProblem('camera')}
              formats={['qr_code']}
              paused={opening}
              constraints={{ facingMode: 'environment' }}
              sound={false}
              styles={{ container: { aspectRatio: '1 / 1', width: '100%' } }}
            />
          </div>
        )}
        {problem === 'notOurs' && <Callout tone="info">{t('qr.notOurs')}</Callout>}
        {opening && (
          <p className="text-center text-sm text-muted-foreground" role="status">
            {t('qr.opening')}
          </p>
        )}
      </div>
    </>
  )
}
