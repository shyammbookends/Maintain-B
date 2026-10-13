import { EVIDENCE_STAGE, type EvidenceStage, type WorkOrderDetail } from '@maintainx/shared'
import { Camera, CheckCircle2, ImagePlus, Images } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { prepareUploads } from '@/utils/image'
import { AttachmentGallery } from './Attachments'
import { CameraCapture } from './CameraCapture'
import { hasLiveCamera } from '@/utils/media'
import { VoiceRecorder } from './VoiceRecorder'

type Upload = (files: File[], stage?: EvidenceStage) => Promise<unknown>

/**
 * Before / during / after evidence. Each stage has the in-app camera and a
 * gallery picker; required stages show until they have a photo. Other files
 * (and voice notes) go under "Other".
 */
export function EvidencePanel({
  w,
  upload,
  large = false,
}: {
  w: WorkOrderDetail
  upload: Upload
  /** Worker app: big touch targets. */
  large?: boolean
}) {
  const { t } = useTranslation()
  const canUpload = w.actions.upload
  const check = w.completionCheck
  const required: Record<EvidenceStage, boolean> = {
    BEFORE: check.needsBeforePhoto || check.evidence.BEFORE > 0,
    DURING: false,
    AFTER: check.needsAfterPhoto || check.evidence.AFTER > 0,
  }
  const missing: Record<EvidenceStage, boolean> = {
    BEFORE: check.needsBeforePhoto,
    DURING: false,
    AFTER: check.needsAfterPhoto,
  }
  const other = w.attachments.filter((a) => a.stage === null)

  return (
    <div className="grid gap-3">
      <div className={cn('grid gap-3', !large && 'lg:grid-cols-3')}>
        {EVIDENCE_STAGE.map((stage) => (
          <StageCard
            key={stage}
            stage={stage}
            items={w.attachments.filter((a) => a.stage === stage)}
            required={required[stage]}
            missing={missing[stage]}
            canUpload={canUpload}
            upload={upload}
            large={large}
          />
        ))}
      </div>
      {(other.length > 0 || canUpload) && (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-13 font-medium">{t('evidence.other')}</p>
          <AttachmentGallery items={other} className="grid grid-cols-3 gap-2 sm:grid-cols-4" />
          {canUpload && (
            <VoiceRecorder
              onRecorded={(file) =>
                void upload([file]).then(
                  () => toast.success(t('evidence.voiceAdded')),
                  (err: unknown) => reportError(err, t),
                )
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

function StageCard({
  stage,
  items,
  required,
  missing,
  canUpload,
  upload,
  large,
}: {
  stage: EvidenceStage
  items: WorkOrderDetail['attachments']
  required: boolean
  missing: boolean
  canUpload: boolean
  upload: Upload
  large: boolean
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const title = t(`evidence.stage_${stage}`)

  async function send(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    try {
      await upload(files, stage)
      toast.success(t('evidence.added', { stage: title }))
    } catch (err) {
      reportError(err, t)
      throw err
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={title}
      className={cn(
        'grid content-start gap-2 rounded-lg border p-3',
        missing && 'border-warning/60 bg-warning-soft/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        {items.length > 0 ? (
          <Badge tone="success">
            <CheckCircle2 aria-hidden /> {items.length}
          </Badge>
        ) : required ? (
          <Badge tone="warning">{t('evidence.required')}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t('common.optional')}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(`evidence.hint_${stage}`)}</p>
      {items.length > 0 && <AttachmentGallery items={items} className="grid grid-cols-3 gap-2" />}
      {canUpload && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size={large ? 'xl' : 'sm'}
            variant={missing ? 'default' : 'secondary'}
            loading={busy}
            onClick={() => (hasLiveCamera() ? setCamera(true) : input.current?.click())}
          >
            <Camera aria-hidden /> {t('evidence.camera')}
          </Button>
          <Button
            size={large ? 'xl' : 'sm'}
            variant="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Images aria-hidden /> {t('evidence.gallery')}
          </Button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        data-testid={`evidence-input-${stage}`}
        aria-label={t('evidence.pick', { stage: title })}
        onChange={(e) => {
          const list = e.target.files
          void (async () => {
            if (list) await send(await prepareUploads(list)).catch(() => undefined)
            if (input.current) input.current.value = ''
          })()
        }}
      />
      {canUpload && hasLiveCamera() && (
        <CameraCapture
          open={camera}
          onOpenChange={setCamera}
          title={t('evidence.cameraTitle', { stage: title })}
          description={t(`evidence.hint_${stage}`)}
          onCapture={(file) => send([file])}
        />
      )}
      {!canUpload && items.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImagePlus className="size-3.5" aria-hidden /> {t('evidence.none')}
        </p>
      )}
    </section>
  )
}
