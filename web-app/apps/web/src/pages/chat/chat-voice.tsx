import { CHAT_VOICE_MAX_SECONDS, formatVoiceDuration, type ChatVoiceDto } from '@maintainx/shared'
import { Check, Download, Mic, Pause, Play, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

/*
 * Voice messages in the team chat: the mic button, the recording bar (timer,
 * cancel and send) and the player shown inside a bubble. Recording itself is
 * in use-voice-recorder.ts.
 */

/** Round mic button for the composer (shown while the text box is empty). */
export function MicButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void
  busy?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      size="icon"
      loading={busy}
      disabled={disabled}
      onClick={onClick}
      aria-label={t('chat.voice.record')}
      title={t('chat.voice.record')}
      data-testid="chat-mic"
      className="bg-brand size-11 shrink-0 rounded-full border-0 shadow-sm"
    >
      <Mic />
    </Button>
  )
}

/** Replaces the text box while recording: red dot, timer, cancel ✕ and send ✓. */
export function RecordingBar({
  seconds,
  sending,
  onCancel,
  onSend,
}: {
  seconds: number
  sending: boolean
  onCancel: () => void
  onSend: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="chat-recording">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCancel}
        disabled={sending}
        aria-label={t('chat.voice.cancel')}
        title={t('chat.voice.cancel')}
        className="size-11 shrink-0 rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger-fg"
      >
        <X className="size-5" />
      </Button>
      <div
        className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-danger-soft/60 px-4"
        role="status"
      >
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-600" />
        </span>
        <span className="truncate text-sm font-medium text-danger-fg">
          {t('chat.voice.recording')}
        </span>
        <span className="ml-auto text-sm font-semibold text-foreground tabular" aria-live="off">
          {formatVoiceDuration(seconds)}
          <span className="font-normal text-muted-foreground">
            {' / '}
            {formatVoiceDuration(CHAT_VOICE_MAX_SECONDS)}
          </span>
        </span>
      </div>
      <Button
        type="button"
        size="icon"
        loading={sending}
        onClick={onSend}
        aria-label={t('chat.voice.send')}
        title={t('chat.voice.send')}
        data-testid="chat-voice-send"
        className="bg-brand size-11 shrink-0 rounded-full border-0 shadow-sm"
      >
        <Check className="size-5" />
      </Button>
    </div>
  )
}

const BARS = 32

/** Waveform-ish bar heights (0.25–1), stable for a message. */
function barsFor(seed: string): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    const wave = 0.55 + 0.35 * Math.sin(i / 2.6)
    return Math.max(0.25, Math.min(1, wave * (0.55 + (h % 1000) / 1100)))
  })
}

/** Can this browser play the format at all? (iPhone Safari can't play WebM.) */
function playable(mime: string) {
  if (typeof document === 'undefined') return true
  const probe = document.createElement('audio')
  if (typeof probe.canPlayType !== 'function') return true
  const alt = mime === 'audio/x-m4a' ? 'audio/mp4' : mime
  return probe.canPlayType(mime) !== '' || probe.canPlayType(alt) !== ''
}

/** A voice message inside a bubble: play / pause, bars that fill as it plays, duration. */
export function VoicePlayer({
  voice,
  seed,
  mine,
}: {
  voice: ChatVoiceDto
  seed: string
  mine: boolean
}) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState(() => !voice.removed && !playable(voice.mimeType))
  const bars = barsFor(seed)
  const total = voice.durationSec || 1
  const progress = Math.min(1, at / total)

  if (voice.removed)
    return (
      <p
        className={cn(
          'flex items-center gap-1.5 text-xs italic',
          mine ? 'text-white/80' : 'text-muted-foreground',
        )}
      >
        <Mic className="size-3.5" aria-hidden />
        {t('chat.voice.removed')}
      </p>
    )

  if (failed)
    return (
      <div className="grid gap-1.5" data-testid="chat-voice-fallback">
        <p
          className={cn(
            'flex items-center gap-1.5 text-13',
            mine ? 'text-white' : 'text-foreground',
          )}
        >
          <Mic className="size-4 shrink-0" aria-hidden />
          {t('chat.voice.label', { duration: formatVoiceDuration(voice.durationSec) })}
        </p>
        <p className={cn('text-xs', mine ? 'text-white/80' : 'text-muted-foreground')}>
          {t('chat.voice.cantPlay')}
        </p>
        <a
          href={voice.url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold',
            mine
              ? 'bg-white/15 text-white hover:bg-white/25'
              : 'bg-info-soft text-info-fg hover:underline',
          )}
        >
          <Download className="size-3.5" aria-hidden />
          {t('chat.voice.download')}
        </a>
      </div>
    )

  function toggle() {
    const el = audio.current
    if (!el) return
    if (el.paused) {
      // One voice message at a time.
      document.querySelectorAll('audio[data-chat-voice]').forEach((other) => {
        if (other !== el) (other as HTMLAudioElement).pause()
      })
      el.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') return
        setFailed(true)
      })
    } else el.pause()
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audio.current
    if (!el) return
    const box = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    try {
      el.currentTime = ratio * total
      setAt(ratio * total)
    } catch {
      // Some recordings (WebM without an index) can't seek; play from where it is.
    }
  }

  const shown = playing || at > 0 ? at : voice.durationSec
  return (
    <div
      className="flex w-[min(15rem,62vw)] items-center gap-2.5 py-0.5"
      data-testid="chat-voice"
      role="group"
      aria-label={t('chat.voice.label', { duration: formatVoiceDuration(voice.durationSec) })}
    >
      <audio
        ref={audio}
        data-chat-voice
        preload="metadata"
        src={voice.url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setAt(0)
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('chat.voice.pause') : t('chat.voice.play')}
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform active:scale-95',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          mine
            ? 'bg-white text-[#4338ca] focus-visible:outline-white'
            : 'bg-brand text-white focus-visible:outline-ring',
        )}
      >
        {playing ? (
          <Pause className="size-4.5 fill-current" aria-hidden />
        ) : (
          <Play className="ml-0.5 size-4.5 fill-current" aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 cursor-pointer items-center gap-[2px]" onClick={seek} aria-hidden>
          {bars.map((h, i) => {
            const played = (i + 0.5) / BARS <= progress
            return (
              <span
                key={i}
                className={cn(
                  'w-[3px] flex-1 rounded-full transition-colors',
                  mine
                    ? played
                      ? 'bg-white'
                      : 'bg-white/40'
                    : played
                      ? 'bg-[#4338ca]'
                      : 'bg-[#4338ca]/25',
                )}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            )
          })}
        </div>
        <p
          className={cn(
            'mt-0.5 text-[11px] font-medium tabular',
            mine ? 'text-white/80' : 'text-muted-foreground',
          )}
        >
          {formatVoiceDuration(shown)}
        </p>
      </div>
    </div>
  )
}
