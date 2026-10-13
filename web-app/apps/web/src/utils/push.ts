import { notificationsApi } from '@/services/platform.service'

/*
 * Web Push for this browser. Needs the service worker (production build),
 * the user's permission and the server's public VAPID key.
 */

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error('no-service-worker')
  return reg
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    return (await (await registration()).pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

/** Asks permission, subscribes this browser and tells the server. */
export async function enablePush(publicKey: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  let reg: ServiceWorkerRegistration
  try {
    reg = await registration()
  } catch {
    return 'unsupported'
  }
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey) as BufferSource,
    }))
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await notificationsApi.subscribePush({ endpoint: json.endpoint, keys: json.keys })
  return 'granted'
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  await notificationsApi.unsubscribePush(sub.endpoint)
  await sub.unsubscribe()
}
