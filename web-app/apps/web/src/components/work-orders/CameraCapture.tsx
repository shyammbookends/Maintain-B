import { Camera, Circle, RotateCcw, Square, SwitchCamera, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/utils/cn'
import { prepareUploads } from '@/utils/image'

/** Short clips keep uploads small on a phone connection. */
const MAX_VIDEO_SECONDS = 30
const VIDEO_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']

const videoType = () =>
  typeof MediaRecorder === 'undefined'
    ? null
    : (VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null)

type Mode = 'photo' | 'video'

/**
 * The device camera, inside the app: take a photo or record a short video,
 * check it, then use it or retake. No switching to another app.
 */
export function CameraCapture({
  open,
  onOpenChange,
  title,
  description,
  allowVideo = true,
  onCapture,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  allowVideo?: boolean
  onCapture: (file: File) => Promise<unknown> | void
}) {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)
  const [mode, setMode] = useState<Mode>('photo')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)
  const [shot, setShot] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false)

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  // Start (or restart) the camera while the dialog is open and nothing is captured.
  useEffect(() => {
    if (!open || shot) return
    let cancelled = false
    setError(null)
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: mode === 'video',
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop())
          return
        }
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play().catch(() => undefined)
        }
      })
      .catch(() => setError(t('camera.blocked')))
    return () => {
      cancelled = true
      stop()
    }
  }, [open, shot, facing, mode, stop, t])

  useEffect(() => {
    if (!open) {
      setShot(null)
      setRecording(false)
      setSeconds(0)
    }
  }, [open])

  useEffect(() => {
    if (!shot) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(shot)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [shot])

  async function takePhoto() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')!.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    if (!blob) return
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const [file] = await prepareUploads([
      new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }),
    ])
    stop()
    setShot(file!)
  }

  function startRecording() {
    const type = videoType()
    if (!type || !stream.current) return
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream.current, { mimeType: type })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      if (timer.current) window.clearInterval(timer.current)
      setRecording(false)
      const mime = type.split(';')[0]!
      const blob = new Blob(chunks, { type: mime })
      if (blob.size === 0) return
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      stream.current?.getTracks().forEach((track) => track.stop())
      setShot(
        new File([blob], `video-${stamp}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`, { type: mime }),
      )
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setRecording(true)
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_VIDEO_SECONDS && rec.state === 'recording') rec.stop()
        return s + 1
      })
    }, 1000)
  }

  async function use() {
    if (!shot) return
    setBusy(true)
    try {
      await onCapture(shot)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const canVideo = allowVideo && videoType() !== null
  const mmss = `0:${String(seconds).padStart(2, '0')}`

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="gap-3 p-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black sm:aspect-video">
          {error ? (
            <p className="flex size-full items-center justify-center p-6 text-center text-sm text-white">
              {error}
            </p>
          ) : shot && preview ? (
            shot.type.startsWith('video/') ? (
              <video src={preview} controls className="size-full object-contain" />
            ) : (
              <img src={preview} alt={t('camera.preview')} className="size-full object-contain" />
            )
          ) : (
            <video
              ref={video}
              muted
              playsInline
              autoPlay
              aria-label={t('camera.viewfinder')}
              className="size-full object-cover"
            />
          )}
          {recording && (
            <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white tabular">
              <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
              {mmss}
            </span>
          )}
        </div>

        {shot ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="xl" disabled={busy} onClick={() => setShot(null)}>
              <RotateCcw aria-hidden /> {t('camera.retake')}
            </Button>
            <Button size="xl" loading={busy} onClick={() => void use()}>
              {t('camera.use')}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {canVideo ? (
              <div
                className="flex rounded-full bg-muted p-1"
                role="group"
                aria-label={t('camera.mode')}
              >
                {(['photo', 'video'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    disabled={recording}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                      mode === m ? 'bg-background shadow-card' : 'text-muted-foreground',
                    )}
                  >
                    {m === 'photo' ? (
                      <Camera className="size-4" aria-hidden />
                    ) : (
                      <Video className="size-4" aria-hidden />
                    )}
                    {t(m === 'photo' ? 'camera.photo' : 'camera.video')}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            {mode === 'photo' ? (
              <button
                type="button"
                onClick={() => void takePhoto()}
                disabled={!!error}
                aria-label={t('camera.take')}
                className="flex size-16 items-center justify-center rounded-full border-4 border-primary bg-background transition-transform active:scale-95 disabled:opacity-50"
              >
                <Circle className="size-10 fill-primary text-primary" aria-hidden />
              </button>
            ) : recording ? (
              <button
                type="button"
                onClick={() => recorder.current?.stop()}
                aria-label={t('camera.stopRecording')}
                className="flex size-16 items-center justify-center rounded-full border-4 border-danger bg-background active:scale-95"
              >
                <Square className="size-7 fill-danger text-danger" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={!!error}
                aria-label={t('camera.record')}
                className="flex size-16 items-center justify-center rounded-full border-4 border-danger bg-background active:scale-95 disabled:opacity-50"
              >
                <Circle className="size-10 fill-danger text-danger" aria-hidden />
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('camera.switch')}
              disabled={recording}
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              <SwitchCamera aria-hidden />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
