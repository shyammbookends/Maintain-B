import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { cn } from '@/utils/cn'

/** Medium error correction survives smudges and a partly torn label. */
const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 1 } as const

/** Renders a QR code as inline SVG (crisp at any print size). */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string
  label: string
  className?: string
}) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { ...QR_OPTIONS, type: 'svg' })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setSvg(null))
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'aspect-square bg-white [&>svg]:size-full',
        !svg && 'animate-pulse bg-muted',
        className,
      )}
      // The SVG string comes from the qrcode library and contains only generated paths.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
}
