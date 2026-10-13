import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

/*
 * Outbound HTTPS to user-supplied URLs (webhooks) without SSRF via DNS
 * rebinding: the host name is resolved once, inside the connection itself,
 * and every address is checked before the socket is opened. Checking first and
 * then letting fetch() resolve the name again would let a short-TTL domain
 * answer "public" for the check and "169.254.169.254" for the real request.
 * Redirects are never followed and the response body is not read.
 */

export class BlockedAddressError extends Error {
  constructor() {
    super('Address not allowed')
    this.name = 'BlockedAddressError'
  }
}

/** A `lookup` for net/tls that refuses any answer containing a blocked address. */
export function guardedLookup(isBlocked: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0)
      const list = addresses as unknown as LookupAddress[]
      if (list.length === 0 || list.some((a) => isBlocked(a.address)))
        return callback(new BlockedAddressError(), '', 0)
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
      }
      callback(null, list[0]!.address, list[0]!.family)
    })
  }
}

export interface PinnedPostResult {
  status: number
}

export function pinnedPost(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  options: { timeoutMs: number; isBlocked: (ip: string) => boolean },
): Promise<PinnedPostResult> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') return Promise.reject(new Error('HTTPS required'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // A literal IP never goes through lookup: check it here.
  if (isIP(host) && options.isBlocked(host)) return Promise.reject(new BlockedAddressError())
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: guardedLookup(options.isBlocked),
        timeout: options.timeoutMs,
      },
      (res) => {
        res.resume() // discard the body
        resolve({ status: res.statusCode ?? 0 })
      },
    )
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    req.end(body)
  })
}
