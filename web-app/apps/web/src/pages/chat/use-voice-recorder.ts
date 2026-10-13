import { CHAT_VOICE_MAX_SECONDS } from '@maintainx/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/toaster'

/*
 * Recording a chat voice message with MediaRecorder (like the work-order
 * VoiceRecorder), preferring AAC in MP4 where the browser can record it,
 * because iPhones can't play WebM.
 */

/** Best first: AAC/MP4 plays everywhere; WebM/Opus is Chrome/Firefox's default; MP4 is Safari's. */
const TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickVoiceType(): string | null {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

/** The browser can record (needs a secure page and MediaRecorder). */
export const canRecordVoice = () =>
  pickVoiceType() !== null && !!navigator.mediaDevices?.getUserMedia

export interface VoiceClip {
  file: File
  durationSec: number
}

/**
 * Microphone recording for one voice message. `finish()` resolves with the
 * clip (or null when nothing was recorded); `cancel()` throws it away. Stops
 * by itself at three minutes and hands the clip to `onAutoStop`.
 */
export function useVoiceRecorder(onAutoStop: (clip: VoiceClip | null) => void) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)
  const settle = useRef<((clip: VoiceClip | null) => void) | null>(null)
  const discard = useRef(false)
  const autoStop = useRef(onAutoStop)
  autoStop.current = onAutoStop

  const cleanup = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    rec.current?.stream.getTracks().forEach((track) => track.stop())
    rec.current = null
    setRecording(false)
  }, [])

  useEffect(
    () => () => {
      discard.current = true
      if (rec.current?.state === 'recording') rec.current.stop()
      cleanup()
    },
    [cleanup],
  )

  const stop = useCallback((): Promise<VoiceClip | null> => {
    const r = rec.current
    if (!r || r.state !== 'recording') return Promise.resolve(null)
    return new Promise((resolve) => {
      settle.current = resolve
      r.stop()
    })
  }, [])

  async function start() {
    const type = pickVoiceType()
    if (!type || starting || recording) return
    setStarting(true)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      const denied = name === 'NotAllowedError' || name === 'SecurityError'
      toast.error(denied ? t('chat.voice.denied') : t('chat.voice.noMic'))
      setStarting(false)
      return
    }
    chunks.current = []
    discard.current = false
    const r = new MediaRecorder(stream, { mimeType: type })
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    r.onstop = () => {
      const elapsed = (Date.now() - startedAt.current) / 1000
      cleanup()
      const mime = (r.mimeType || type).split(';')[0]!
      const blob = new Blob(chunks.current, { type: mime })
      const clip =
        discard.current || blob.size === 0
          ? null
          : {
              file: new File([blob], `voice-message.${extensionOf(mime)}`, { type: mime }),
              durationSec: Math.min(CHAT_VOICE_MAX_SECONDS, Math.max(1, Math.round(elapsed))),
            }
      const done = settle.current
      settle.current = null
      if (done) done(clip)
      else autoStop.current(clip)
    }
    rec.current = r
    // Small slices so a stop right away still has data.
    r.start(250)
    startedAt.current = Date.now()
    setSeconds(0)
    setRecording(true)
    setStarting(false)
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(s)
      if (s >= CHAT_VOICE_MAX_SECONDS && r.state === 'recording') {
        toast.info(t('chat.voice.limit'))
        r.stop()
      }
    }, 250)
  }

  return {
    recording,
    starting,
    seconds,
    start: () => void start(),
    finish: stop,
    cancel: () => {
      discard.current = true
      void stop()
    },
  }
}

function extensionOf(mime: string) {
  if (mime === 'audio/mp4') return 'm4a'
  if (mime === 'audio/ogg') return 'ogg'
  return 'webm'
}
