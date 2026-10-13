import { Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'

/** Long enough to describe a problem, small enough to upload on a phone connection. */
const MAX_SECONDS = 120

/** Formats the browser can record that the server accepts, best first. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickType(): string | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

const canRecordVoice = () => pickType() !== null && !!navigator.mediaDevices?.getUserMedia

/**
 * Records a voice note with the device microphone, right inside the app.
 * Hidden when the browser can't record; stops itself after two minutes.
 */
export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  if (!canRecordVoice()) return null

  async function start() {
    const type = pickType()!
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast.error(t('voice.micError'))
      return
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: type })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      if (timer.current) window.clearInterval(timer.current)
      setRecording(false)
      const mime = type.split(';')[0]!
      const blob = new Blob(chunks, { type: mime })
      if (blob.size === 0) return
      const ext = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm'
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      onRecorded(new File([blob], `voice-note-${stamp}.${ext}`, { type: mime }))
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setRecording(true)
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS && rec.state === 'recording') rec.stop()
        return s + 1
      })
    }, 1000)
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return recording ? (
    <Button
      variant="destructive"
      size="xl"
      className="justify-start"
      onClick={() => recorder.current?.stop()}
    >
      <Square aria-hidden />
      <span className="flex items-center gap-2">
        {t('voice.stop')}
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-white" />
        </span>
        <span className="tabular" aria-live="off">
          {mmss}
        </span>
      </span>
    </Button>
  ) : (
    <Button
      variant="secondary"
      size="xl"
      className="justify-start"
      disabled={disabled}
      onClick={() => void start()}
    >
      <Mic aria-hidden /> {t('voice.record')}
    </Button>
  )
}
