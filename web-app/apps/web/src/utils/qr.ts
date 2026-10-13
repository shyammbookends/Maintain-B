import QRCode from 'qrcode'

/*
 * Printed QR codes point at short public links any phone camera can open:
 *   /a/<id> an asset · /l/<id> a location · /p/<id> a part.
 * Sign-in is handled by the route guard; the landing page then opens the
 * record in the user's own app.
 */

export type QrKind = 'asset' | 'location' | 'part'

const PREFIX: Record<QrKind, string> = { asset: 'a', location: 'l', part: 'p' }

export function qrUrl(kind: QrKind, publicId: string): string {
  return `${window.location.origin}/${PREFIX[kind]}/${publicId}`
}

/** URL a printed asset QR code points to. */
export const assetQrUrl = (publicId: string) => qrUrl('asset', publicId)
export const locationQrUrl = (publicId: string) => qrUrl('location', publicId)
export const partQrUrl = (publicId: string) => qrUrl('part', publicId)

/** Public request portal (no login): a restaurant's portalId or a location's publicId. */
export const portalUrl = (token: string) => `${window.location.origin}/r/${token}`

/** Medium error correction survives smudges and a partly torn label. */
const OPTIONS = { errorCorrectionLevel: 'M', margin: 1 } as const

/** Downloads a high-resolution PNG of the QR code. */
export async function downloadQrPng(value: string, fileName: string): Promise<void> {
  const url = await QRCode.toDataURL(value, { ...OPTIONS, width: 1024 })
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
}

/**
 * Reads one of our QR links from any host (labels printed before a domain
 * change keep working). Older rows use hex ids, newer ones base-58.
 */
export function parseAppQr(raw: string): { kind: QrKind; publicId: string } | null {
  try {
    const url = new URL(raw)
    const m = url.pathname.match(/^\/([alp])\/([0-9A-Za-z]{8,40})\/?$/)
    if (!m) return null
    const kind = (Object.keys(PREFIX) as QrKind[]).find((k) => PREFIX[k] === m[1])!
    return { kind, publicId: m[2]! }
  } catch {
    return null
  }
}

/** The asset public id from a scanned value, or null. */
export function parseAssetQr(raw: string): string | null {
  const hit = parseAppQr(raw)
  return hit?.kind === 'asset' ? hit.publicId : null
}
