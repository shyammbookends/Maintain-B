import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalStorageProvider } from './local.provider.js'
import { signFileLink, verifyFileLink } from './signing.js'

const SECRET = 'unit-test-secret-unit-test-secret-unit-test-secret'
let dir: string
let storage: LocalStorageProvider

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mx-storage-'))
  storage = new LocalStorageProvider(dir, SECRET)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

describe('LocalStorageProvider', () => {
  it('stores and reads back a buffer', async () => {
    const stored = await storage.put('docs/2026/a.txt', Buffer.from('hello'), {
      mimeType: 'text/plain',
    })
    expect(stored).toEqual({ key: 'docs/2026/a.txt', size: 5, mimeType: 'text/plain' })
    expect(await readAll(await storage.getStream('docs/2026/a.txt'))).toBe('hello')
    expect(await storage.head('docs/2026/a.txt')).toEqual({ size: 5 })
  })

  it('stores a stream', async () => {
    await storage.put('docs/stream.txt', Readable.from(['chunk-1', 'chunk-2']), {
      mimeType: 'text/plain',
    })
    expect(await readAll(await storage.getStream('docs/stream.txt'))).toBe('chunk-1chunk-2')
  })

  it('reports missing objects without throwing', async () => {
    expect(await storage.head('nope/missing.bin')).toBeNull()
    expect(await storage.exists('nope/missing.bin')).toBe(false)
  })

  it('deletes idempotently', async () => {
    await storage.put('tmp/x.bin', Buffer.from([1, 2, 3]), { mimeType: 'application/octet-stream' })
    await storage.delete('tmp/x.bin')
    await storage.delete('tmp/x.bin')
    expect(await storage.exists('tmp/x.bin')).toBe(false)
  })

  it('rejects traversal and absolute keys', async () => {
    for (const bad of [
      '../etc/passwd',
      'a/../../b',
      '/abs/path',
      'C:/win',
      'a//b',
      '.hidden',
      'a/./b',
    ]) {
      await expect(storage.put(bad, Buffer.from('x'), { mimeType: 'text/plain' })).rejects.toThrow(
        /Invalid storage key/,
      )
    }
  })

  it('issues signed links that verify and expire', async () => {
    const url = await storage.getSignedUrl('docs/2026/a.txt', {
      expiresInSeconds: 60,
      mimeType: 'text/plain',
      fileName: 'a.txt',
      disposition: 'inline',
    })
    const params = new URL(url, 'http://localhost').searchParams
    const claims = {
      key: params.get('key')!,
      exp: Number(params.get('exp')),
      type: params.get('type')!,
      name: params.get('name')!,
      dl: params.get('dl') as '0' | '1',
      sig: params.get('sig')!,
    }
    expect(url.startsWith('/api/v1/files?')).toBe(true)
    expect(verifyFileLink(claims, SECRET)).toBe(true)
    expect(verifyFileLink({ ...claims, type: 'text/html' }, SECRET)).toBe(false)
    expect(verifyFileLink({ ...claims, key: 'docs/2026/b.txt' }, SECRET)).toBe(false)
    expect(verifyFileLink(claims, 'another-secret-another-secret-another-secret')).toBe(false)
    expect(verifyFileLink(claims, SECRET, claims.exp + 1)).toBe(false)
  })

  it('signature is deterministic for identical claims', () => {
    const claims = { key: 'k', exp: 1, type: 't', name: 'n', dl: '0' as const }
    expect(signFileLink(claims, SECRET)).toBe(signFileLink(claims, SECRET))
  })
})
