import { randomBytes } from 'node:crypto'

// Base-58 style alphabet: no 0/O or I/l ambiguity, safe in URLs and when read aloud.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Unguessable public identifier for QR codes and share links (default 12 chars ≈ 70 bits). */
export function generatePublicId(length = 12): string {
  let out = ''
  // Rejection sampling keeps the distribution uniform.
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  while (out.length < length) {
    const bytes = randomBytes(length * 2)
    for (const b of bytes) {
      if (b < max) out += ALPHABET[b % ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
}

/** WO-000123, AST-0042, … */
export function formatCode(prefix: string, sequence: number, width = 6): string {
  return `${prefix}-${String(sequence).padStart(width, '0')}`
}
