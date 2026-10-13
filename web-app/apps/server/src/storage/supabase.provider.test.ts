import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupabaseStorageProvider } from './supabase.provider.js'

/* The Supabase driver speaks the Storage REST API; checked against a fake server. */

const cfg = { url: 'https://abc.supabase.co', serviceKey: 'service-role-key-1234567890', bucket: 'files' }

afterEach(() => vi.unstubAllGlobals())

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return handler(url, init)
    }),
  )
  return calls
}

describe('SupabaseStorageProvider', () => {
  it('uploads with upsert, signs links and deletes by prefix', async () => {
    const calls = fakeFetch((url) => {
      if (url.includes('/object/sign/'))
        return Response.json({ signedURL: '/object/sign/files/a/b.webp?token=t' })
      return new Response('{}', { status: 200 })
    })
    const s = new SupabaseStorageProvider(cfg)
    await s.put('a/b.webp', Buffer.from('x'), { mimeType: 'image/webp' })
    expect(calls[0]!.url).toBe('https://abc.supabase.co/storage/v1/object/files/a/b.webp')
    expect(calls[0]!.init.headers).toMatchObject({
      'x-upsert': 'true',
      'Content-Type': 'image/webp',
      Authorization: `Bearer ${cfg.serviceKey}`,
    })

    const inline = await s.getSignedUrl('a/b.webp', {
      expiresInSeconds: 60,
      mimeType: 'image/webp',
      fileName: 'b.webp',
    })
    expect(inline).toBe('https://abc.supabase.co/storage/v1/object/sign/files/a/b.webp?token=t')
    const download = await s.getSignedUrl('a/b.webp', {
      expiresInSeconds: 60,
      mimeType: 'image/webp',
      fileName: 'report photo.webp',
      disposition: 'attachment',
    })
    expect(download).toContain('&download=report%20photo.webp')

    await s.delete('a/b.webp')
    const del = calls.at(-1)!
    expect(del.url).toBe('https://abc.supabase.co/storage/v1/object/files')
    expect(JSON.parse(String(del.init.body))).toEqual({ prefixes: ['a/b.webp'] })
  })

  it('reports missing files and refuses unsafe keys', async () => {
    fakeFetch(() => new Response('not found', { status: 400 }))
    const s = new SupabaseStorageProvider(cfg)
    expect(await s.exists('a/missing.webp')).toBe(false)
    await expect(s.put('../etc/passwd', Buffer.from('x'), { mimeType: 'text/plain' })).rejects.toThrow()
  })
})

describe('SupabaseStorageProvider bucket', () => {
  it('creates the private bucket on the first upload when it is missing', async () => {
    let created = false
    const calls = fakeFetch((url) => {
      if (url.endsWith('/storage/v1/bucket')) {
        created = true
        return Response.json({ name: 'files' })
      }
      return created
        ? Response.json({ Key: 'files/a/b.webp' })
        : Response.json({ error: 'Bucket not found' }, { status: 404 })
    })
    await new SupabaseStorageProvider(cfg).put('a/b.webp', Buffer.from('x'), {
      mimeType: 'image/webp',
    })
    const bucket = calls.find((c) => c.url.endsWith('/bucket'))!
    expect(JSON.parse(String(bucket.init.body))).toEqual({ id: 'files', name: 'files', public: false })
    expect(calls).toHaveLength(3)
  })
})
