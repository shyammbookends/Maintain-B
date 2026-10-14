import { describe, expect, it } from 'vitest'
import { decideUpdate, manifestSchema } from './app-updates.service.js'

const manifest = manifestSchema.parse({
  android: {
    version: '1.17.0',
    build: 23,
    minBuild: 22,
    file: 'android/BookendsMaintenance-1.17.0.apk',
    sha256: 'a'.repeat(64),
    size: 31_000_000,
    notes: { en: ['Faster reports'], hi: ['रिपोर्ट तेज़'] },
    publishedAt: '2026-10-14T12:00:00.000Z',
  },
})

describe('decideUpdate', () => {
  it('offers a newer build', () => {
    expect(decideUpdate(manifest, 'android', 22)).toMatchObject({ available: true, required: false })
  })

  it('forces builds below minBuild', () => {
    expect(decideUpdate(manifest, 'android', 21)).toMatchObject({ available: true, required: true })
  })

  it('stays quiet for the current or a newer build', () => {
    expect(decideUpdate(manifest, 'android', 23)).toEqual({ available: false })
    expect(decideUpdate(manifest, 'android', 24)).toEqual({ available: false })
  })

  it('has no iPhone or missing-manifest offers', () => {
    expect(decideUpdate(manifest, 'ios', 1)).toEqual({ available: false })
    expect(decideUpdate(null, 'android', 1)).toEqual({ available: false })
  })
})

describe('manifestSchema', () => {
  it('rejects a file outside android/ and a bad checksum', () => {
    const bad = (patch: object) =>
      manifestSchema.safeParse({ android: { ...manifest.android, ...patch } }).success
    expect(bad({ file: '../secret.apk' })).toBe(false)
    expect(bad({ file: 'attachments/x.apk' })).toBe(false)
    expect(bad({ sha256: 'xyz' })).toBe(false)
  })
})
