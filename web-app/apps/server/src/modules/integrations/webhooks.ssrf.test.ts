import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from './webhooks.service.js'

/* Webhook targets: nothing inside the server's own network, however the address is written. */

describe('webhook address filter', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    // IPv4-mapped, written both ways (new URL() turns the dotted form into hex).
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:ac10:1',
    '::ffff:7f00:1',
    // NAT64 and 6to4 wrapping private IPv4.
    '64:ff9b::a9fe:a9fe',
    '2002:a9fe:a9fe::1',
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808', '172.32.0.1'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  )

  it('matches what URL parsing produces for a bracketed mapped address', () => {
    const host = new URL('https://[::ffff:169.254.169.254]/').hostname.replace(/^\[|\]$/g, '')
    expect(isPrivateAddress(host)).toBe(true)
  })
})

describe('pinned delivery (DNS rebinding)', () => {
  it('checks the address actually connected to, not an earlier lookup', async () => {
    const { pinnedPost, BlockedAddressError } = await import('../../core/safe-http.js')
    // "localhost" resolves to a loopback address at connect time: refused before any socket opens.
    await expect(
      pinnedPost('https://localhost:9/x', {}, '{}', { timeoutMs: 2000, isBlocked: isPrivateAddress }),
    ).rejects.toBeInstanceOf(BlockedAddressError)
    await expect(
      pinnedPost('https://169.254.169.254/latest', {}, '{}', {
        timeoutMs: 2000,
        isBlocked: isPrivateAddress,
      }),
    ).rejects.toBeInstanceOf(BlockedAddressError)
    await expect(
      pinnedPost('http://example.com/x', {}, '{}', { timeoutMs: 2000, isBlocked: () => false }),
    ).rejects.toThrow('HTTPS required')
  })
})
