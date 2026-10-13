import type { ChecklistItemDto, StepAnswerInput } from '@maintainx/shared'
import { fullName } from '@maintainx/shared'
import { Camera, Check, Images } from 'lucide-react'
import { Link } from 'react-router'
import { useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentGallery } from '@/components/work-orders/Attachments'
import { CameraCapture } from '@/components/work-orders/CameraCapture'
import { hasLiveCamera } from '@/utils/media'
import { ResultToggle } from '@/components/worker/ResultToggle'
import { cn } from '@/utils/cn'
import { reportError } from '@/utils/errors'
import { formatNumber } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'
import { prepareUploads } from '@/utils/image'
import { rangeLabel, visibleSteps } from './checklist-utils'
import { SignaturePad } from './SignaturePad'

export type AnswerFn = (itemId: string, input: StepAnswerInput) => Promise<unknown>
export type UploadFn = (itemId: string, files: File[]) => Promise<unknown>

/**
 * A list of steps. Editable: every answer is saved as soon as it's given
 * (tap a result, tick a box, pick an option, take a photo, sign, or leave a
 * number / text field). Read-only: shows results, photos and signatures.
 */
export function Checklist({
  items,
  editable,
  onAnswer,
  onUpload,
  correctiveLinkBase = '/work-orders',
}: {
  items: ChecklistItemDto[]
  editable: boolean
  onAnswer?: AnswerFn
  /** Photos and signatures for a step. */
  onUpload?: UploadFn
  /** Where follow-up work orders open (workers can't open admin pages). */
  correctiveLinkBase?: string | null
}) {
  // Steps whose condition doesn't hold stay out of the way until it does.
  const shown = visibleSteps(items)
  return (
    <ol className="grid gap-4">
      {shown.map((item) =>
        item.inputType === 'SECTION' ? (
          <li key={item.id} className="pt-2">
            <h3 className="border-b pb-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {item.title}
            </h3>
            {item.instruction && (
              <p className="mt-1 text-13 text-muted-foreground">{item.instruction}</p>
            )}
          </li>
        ) : (
        <li key={item.id}>
          <Step
            item={item}
            editable={editable && !!onAnswer}
            onAnswer={onAnswer}
            onUpload={onUpload}
            correctiveLinkBase={correctiveLinkBase}
          />
        </li>
        ),
      )}
    </ol>
  )
}

function Step({
  item,
  editable,
  onAnswer,
  onUpload,
  correctiveLinkBase,
}: {
  item: ChecklistItemDto
  editable: boolean
  onAnswer?: AnswerFn
  onUpload?: UploadFn
  correctiveLinkBase: string | null
}) {
  const { t } = useTranslation()
  const [num, setNum] = useState(item.numericValue === null ? '' : String(item.numericValue))
  const [text, setText] = useState(item.textValue ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [noteOpen, setNoteOpen] = useState(!!item.note)
  const [saving, setSaving] = useState(false)
  const [camera, setCamera] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const labelId = `step-${item.id}`
  const range = item.inputType === 'NUMBER' ? rangeLabel(item, t) : ''
  const needsPhoto = item.inputType === 'PHOTO' || item.requirePhoto
  const photoMissing = needsPhoto && item.attachments.length === 0
  const canUpload = editable && !!onUpload

  /** Sends the full current answer; `patch` overrides what just changed. */
  async function save(patch: Partial<StepAnswerInput> = {}) {
    if (!onAnswer) return
    const n = num.trim() === '' ? undefined : Number(num.replace(',', '.'))
    const input: StepAnswerInput = {
      result:
        item.inputType === 'PASS_FAIL_NA' || item.inputType === 'CHECKBOX'
          ? (item.result ?? '')
          : '',
      numericValue: n !== undefined && !Number.isNaN(n) ? n : undefined,
      textValue: text,
      note,
      ...patch,
    }
    setSaving(true)
    try {
      await onAnswer(item.id, input)
    } catch (err) {
      reportError(err, t)
    } finally {
      setSaving(false)
    }
  }

  async function upload(files: File[]) {
    if (!onUpload || files.length === 0) return
    setSaving(true)
    try {
      await onUpload(item.id, files)
    } catch (err) {
      reportError(err, t)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const failed = item.result === 'FAIL'
  const signatures = item.inputType === 'SIGNATURE' ? item.attachments : []
  const photos = item.inputType === 'SIGNATURE' ? [] : item.attachments

  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border p-3',
        failed && 'border-danger/50 bg-danger-soft/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p id={labelId} className="text-sm font-medium">
          {item.position}. {item.title}
          {!item.required && (
            <span className="ml-1 font-normal text-muted-foreground">({t('common.optional')})</span>
          )}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          {saving && <Spinner className="size-4" />}
          {item.requirePhoto && item.inputType !== 'PHOTO' && (
            <Badge tone={photoMissing ? 'warning' : 'success'}>
              <Camera aria-hidden /> {t('checklist.photoRequired')}
            </Badge>
          )}
          {item.result && <StatusBadge kind="stepResult" value={item.result} />}
        </span>
      </div>
      {item.instruction && <p className="text-13 text-muted-foreground">{item.instruction}</p>}
      {item.showIf && (
        <p className="text-xs text-muted-foreground">
          {t('checklist.shownBecause', { step: item.showIf.step, answer: answerLabel(t, item.showIf.answer) })}
        </p>
      )}

      {item.inputType === 'PASS_FAIL_NA' &&
        (editable ? (
          <ResultToggle
            labelledBy={labelId}
            value={item.result}
            disabled={saving}
            onChange={(v) => {
              if (v === 'FAIL') setNoteOpen(true)
              void save({ result: v })
            }}
          />
        ) : null)}

      {item.inputType === 'CHECKBOX' &&
        (editable ? (
          <button
            type="button"
            aria-pressed={item.result === 'PASS'}
            aria-labelledby={labelId}
            disabled={saving}
            onClick={() => void save({ result: item.result === 'PASS' ? '' : 'PASS' })}
            className={cn(
              'flex h-12 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition-colors',
              item.result === 'PASS'
                ? 'border-success/50 bg-success-soft text-success-fg'
                : 'hover:bg-muted/60',
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-md border-2',
                item.result === 'PASS' ? 'border-success bg-success text-white' : 'border-input',
              )}
              aria-hidden
            >
              {item.result === 'PASS' && <Check className="size-4" />}
            </span>
            {item.result === 'PASS' ? t('checklist.ticked') : t('checklist.tick')}
          </button>
        ) : null)}

      {item.inputType === 'MULTIPLE_CHOICE' &&
        (editable ? (
          <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
            {item.options.map((o) => {
              const chosen = item.textValue === o
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  disabled={saving}
                  onClick={() => {
                    setText(o)
                    void save({ textValue: o })
                  }}
                  className={cn(
                    'h-11 rounded-full border px-4 text-sm font-medium transition-colors',
                    chosen ? 'border-primary bg-info-soft text-info-fg' : 'hover:bg-muted/60',
                  )}
                >
                  {o}
                </button>
              )
            })}
          </div>
        ) : (
          item.textValue && <p className="text-sm font-medium">{item.textValue}</p>
        ))}

      {item.inputType === 'NUMBER' &&
        (editable ? (
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                aria-labelledby={labelId}
                aria-describedby={range ? `${labelId}-range` : undefined}
                value={num}
                onChange={(e) => setNum(e.target.value)}
                onBlur={() => {
                  if (num !== (item.numericValue === null ? '' : String(item.numericValue)))
                    void save()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                className="h-12 max-w-40 text-base tabular"
              />
              {item.unit && <span className="text-sm text-muted-foreground">{item.unit}</span>}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={saving}
                onClick={() => {
                  setNum('')
                  void save({ numericValue: undefined, result: 'NA' })
                }}
              >
                {t('checklist.notApplicable')}
              </Button>
            </div>
            {range && (
              <p id={`${labelId}-range`} className="text-xs text-muted-foreground">
                {range}
              </p>
            )}
          </div>
        ) : (
          item.numericValue !== null && (
            <p className="text-sm tabular">
              {formatNumber(item.numericValue)}
              {item.unit ? ` ${item.unit}` : ''}
              {range && <span className="ml-2 text-xs text-muted-foreground">({range})</span>}
            </p>
          )
        ))}

      {item.inputType === 'TEXT' &&
        (editable ? (
          <Textarea
            aria-labelledby={labelId}
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text !== (item.textValue ?? '')) void save()
            }}
          />
        ) : (
          item.textValue && <p className="text-sm whitespace-pre-wrap">{item.textValue}</p>
        ))}

      {item.inputType === 'SIGNATURE' && (
        <>
          {signatures.length > 0 && (
            <img
              src={signatures[signatures.length - 1]!.url}
              alt={t('checklist.signatureOf', { step: item.title })}
              className="h-24 w-auto justify-self-start rounded-md border bg-white p-1"
            />
          )}
          {canUpload && (
            <SignaturePad
              label={t('checklist.signHere', { step: item.title })}
              disabled={saving}
              onSave={(file) => upload([file])}
            />
          )}
        </>
      )}

      {needsPhoto && (
        <>
          {photos.length > 0 && (
            <AttachmentGallery items={photos} className="grid grid-cols-4 gap-2" />
          )}
          {canUpload && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={photoMissing ? 'default' : 'secondary'}
                disabled={saving}
                onClick={() => (hasLiveCamera() ? setCamera(true) : fileInput.current?.click())}
              >
                <Camera aria-hidden /> {t('checklist.takePhoto')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => fileInput.current?.click()}
              >
                <Images aria-hidden /> {t('evidence.gallery')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                aria-label={t('checklist.photoFor', { step: item.title })}
                data-testid={`step-photo-${item.position}`}
                onChange={(e) => {
                  const list = e.target.files
                  void (async () => {
                    if (list) await upload(await prepareUploads(list)).catch(() => undefined)
                    if (fileInput.current) fileInput.current.value = ''
                  })()
                }}
              />
              {hasLiveCamera() && (
                <CameraCapture
                  open={camera}
                  onOpenChange={setCamera}
                  title={item.title}
                  allowVideo={false}
                  onCapture={(file) => upload([file])}
                />
              )}
            </div>
          )}
        </>
      )}

      {editable ? (
        noteOpen ? (
          <Textarea
            aria-label={t('checklist.noteFor', { step: item.title })}
            placeholder={
              failed ? t('checklist.failNotePlaceholder') : t('checklist.notePlaceholder')
            }
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (item.note ?? '') && item.result !== null) void save()
            }}
          />
        ) : (
          <Button
            variant="link"
            size="sm"
            className="justify-self-start"
            onClick={() => setNoteOpen(true)}
          >
            {t('checklist.addNote')}
          </Button>
        )
      ) : (
        item.note && <p className="text-13 whitespace-pre-wrap text-foreground/90">{item.note}</p>
      )}

      {(item.completedBy || item.correctiveWorkOrder) && (
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {item.completedBy && !editable && <span>{fullName(item.completedBy)}</span>}
          {item.correctiveWorkOrder &&
            (correctiveLinkBase ? (
              <Link
                to={`${correctiveLinkBase}/${item.correctiveWorkOrder.id}`}
                className="font-medium text-primary hover:underline"
              >
                {t('checklist.followUp', { code: item.correctiveWorkOrder.code })}
              </Link>
            ) : (
              <span>{t('checklist.followUp', { code: item.correctiveWorkOrder.code })}</span>
            ))}
        </p>
      )}
    </div>
  )
}

/** PASS / FAIL / NA in words; choice answers as typed. */
function answerLabel(t: TFunction, answer: string) {
  return answer === 'PASS' || answer === 'FAIL' || answer === 'NA'
    ? enumLabel(t, 'stepResult', answer)
    : answer
}
