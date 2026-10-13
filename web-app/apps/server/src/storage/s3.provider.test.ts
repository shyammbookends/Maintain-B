import { S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { S3StorageProvider } from './s3.provider.js'

/** Offline tests: the client's send() is stubbed; URL signing needs no network. */
function setup() {
  const client = new S3Client({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
  })
  const send = vi.spyOn(client, 'send')
  const storage = new S3StorageProvider(
    { bucket: 'mx-files', region: 'ap-south-1', prefix: 'prod/' },
    client,
  )
  return { storage, send }
}

describe('S3StorageProvider', () => {
  it('writes private, encrypted objects under the prefix', async () => {
    const { storage, send } = setup()
    send.mockResolvedValue({} as never)
    const res = await storage.put('attachments/2026/10/a.jpg', Buffer.from('abc'), {
      mimeType: 'image/jpeg',
    })
    expect(res).toEqual({ key: 'attachments/2026/10/a.jpg', size: 3, mimeType: 'image/jpeg' })
    const input = (send.mock.calls[0]![0] as unknown as { input: Record<string, unknown> }).input
    expect(input).toMatchObject({
      Bucket: 'mx-files',
      Key: 'prod/attachments/2026/10/a.jpg',
      ContentType: 'image/jpeg',
      ServerSideEncryption: 'AES256',
    })
  })

  it('reports missing objects as null and rejects unsafe keys', async () => {
    const { storage, send } = setup()
    send.mockRejectedValue(Object.assign(new Error('nf'), { name: 'NotFound' }))
    expect(await storage.head('documents/x.pdf')).toBeNull()
    expect(await storage.exists('documents/x.pdf')).toBe(false)
    await expect(
      storage.put('../etc/passwd', Buffer.from(''), { mimeType: 'text/plain' }),
    ).rejects.toThrow('Invalid storage key')
  })

  it('signs short-lived download links with type and file name', async () => {
    const { storage } = setup()
    const url = new URL(
      await storage.getSignedUrl('documents/2026/10/lic.pdf', {
        expiresInSeconds: 600,
        mimeType: 'application/pdf',
        fileName: 'FSSAI licence.pdf',
        disposition: 'attachment',
      }),
    )
    expect(url.hostname).toContain('mx-files')
    expect(url.pathname).toBe('/prod/documents/2026/10/lic.pdf')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf')
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'attachment; filename="FSSAI licence.pdf"',
    )
  })
})
