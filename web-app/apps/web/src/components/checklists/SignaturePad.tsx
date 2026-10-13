import { Eraser } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * Sign with a finger or mouse. Saves a PNG (white background, dark ink) that
 * is uploaded as the step's signature.
 */
export function SignaturePad({
  label,
  onSave,
  disabled,
}: {
  label: string
  onSave: (file: File) => Promise<unknown>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const clear = () => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    setDirty(false)
  }

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    // Draw at device resolution so the signature stays sharp.
    const ratio = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = Math.max(1, Math.round(rect.width * ratio))
    c.height = Math.max(1, Math.round(rect.height * ratio))
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  async function save() {
    const c = canvas.current
    if (!c) return
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!blob) return
    setSaving(true)
    try {
      await onSave(new File([blob], 'signature.png', { type: 'image/png' }))
      clear()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="h-36 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          if (disabled) return
          drawing.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          const ctx = e.currentTarget.getContext('2d')!
          const p = point(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = e.currentTarget.getContext('2d')!
          const p = point(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          setDirty(true)
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={clear} disabled={!dirty || saving}>
          <Eraser aria-hidden /> {t('checklist.clearSignature')}
        </Button>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || disabled}
          loading={saving}
        >
          {t('checklist.saveSignature')}
        </Button>
      </div>
    </div>
  )
}
