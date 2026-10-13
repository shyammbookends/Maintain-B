import { EventEmitter } from 'node:events'

/*
 * In-process "something new for this user" signal. notify() fires it when it
 * stores notifications; the phone app's long-poll on /push-feed waits on it, so
 * alerts arrive within a second instead of on the next 20 s poll.
 * One server process (local / single instance). With several instances a poll
 * still returns on its timeout, so nothing is lost — it is only slower.
 */
const bus = new EventEmitter()
bus.setMaxListeners(0)

export function signalUsers(userIds: Iterable<string>): void {
  for (const id of userIds) bus.emit(`user:${id}`)
}

/** Resolves when [userId] gets something new, or after [ms]; `signal` stops waiting early. */
export function waitForUser(userId: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const key = `user:${userId}`
    const done = () => {
      clearTimeout(timer)
      bus.off(key, done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    bus.once(key, done)
    signal?.addEventListener('abort', done, { once: true })
  })
}
