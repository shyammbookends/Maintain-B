import { UPLOAD_MAX_FILES, type AttachmentDto } from '@maintainx/shared'
import { Archive, Camera, Film, Mic } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, type ButtonProps } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { reportError } from '@/utils/errors'
import { formatDateTime } from '@/utils/format'
import { prepareUploads } from '@/utils/image'
import { uploaderName } from '@/utils/people'

/** Thumbnails that open the full photo or video in a new tab; voice notes play inline. */
export function AttachmentGallery({
  items,
  className,
}: {
  items: AttachmentDto[]
  className?: string
}) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  const visual = items.filter((a) => a.kind !== 'AUDIO')
  const voice = items.filter((a) => a.kind === 'AUDIO')
  return (
    <div className="grid gap-2">
      {voice.length > 0 && (
        <ul className="grid gap-2">
          {voice
            .filter((a) => !a.removed)
            .map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2"
              >
                <Mic className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-13 text-muted-foreground">
                  {t('wo.photoBy', {
                    name: uploaderName(t, a.uploadedBy),
                    time: formatDateTime(a.createdAt),
                  })}
                </span>
                <audio
                  controls
                  preload="none"
                  src={a.url}
                  className="h-9 w-full min-w-0 sm:w-auto sm:flex-1"
                >
                  <track kind="captions" />
                </audio>
              </li>
            ))}
        </ul>
      )}
      {visual.length > 0 && (
        <ul className={className ?? 'grid grid-cols-3 gap-2 sm:grid-cols-4'}>
          {visual.map((a) => {
            const caption = t('wo.photoBy', {
              name: uploaderName(t, a.uploadedBy),
              time: formatDateTime(a.createdAt),
            })
            // Removed by the retention policy: the record stays, the file is gone.
            if (a.removed)
              return (
                <li key={a.id}>
                  <span
                    title={caption}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 p-1 text-center text-[11px] text-muted-foreground"
                  >
                    <Archive className="size-5" aria-hidden />
                    {t('storage.fileRemoved')}
                  </span>
                </li>
              )
            return (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  title={caption}
                  aria-label={`${a.fileName} · ${caption}`}
                  className="block aspect-square overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {a.kind === 'PHOTO' ? (
                    <img
                      src={a.thumbUrl ?? a.url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                      decoding="async"
                    />
                  ) : (
                    <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Film className="size-6" aria-hidden />
                      {t('wo.video')}
                    </span>
                  )}
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Opens the camera / gallery, shrinks photos on the device and hands them to
 * `upload`. Shows its own progress and errors.
 */
export function PhotoUploadButton({
  upload,
  label,
  onUploaded,
  ...buttonProps
}: Omit<ButtonProps, 'onClick' | 'loading'> & {
  upload: (files: File[]) => Promise<unknown>
  label?: string
  onUploaded?: () => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onChange(list: FileList | null) {
    if (!list || list.length === 0) return
    if (list.length > UPLOAD_MAX_FILES) toast.info(t('wo.tooManyFiles', { max: UPLOAD_MAX_FILES }))
    setBusy(true)
    try {
      await upload(await prepareUploads(list))
      toast.success(t('wo.photosAdded'))
      onUploaded?.()
    } catch (err) {
      reportError(err, t)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => void onChange(e.target.files)}
        data-testid="photo-input"
      />
      <Button
        variant="secondary"
        {...buttonProps}
        loading={busy}
        onClick={() => input.current?.click()}
      >
        <Camera aria-hidden /> {label ?? t('wo.addPhotos')}
      </Button>
    </>
  )
}
