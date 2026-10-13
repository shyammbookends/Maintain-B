#!/usr/bin/env node
/**
 * Stops whatever is still listening on the dev ports (API 4000, web 5173), e.g. a
 * `npm run dev` left running in another terminal, which makes a new one fail with
 * "Port 5173 is already in use" and take the API down with it.
 *
 *   npm run stop         free the ports
 *   npm run dev:clean    free the ports, then npm run dev
 *
 * Extra ports: node scripts/free-ports.mjs 4000 5173 4100
 */
import { execSync } from 'node:child_process'

const ports = process.argv.slice(2).map(Number).filter(Boolean)
if (ports.length === 0)
  ports.push(Number(process.env.PORT ?? 4000), Number(process.env.VITE_PORT ?? 5173))

const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function pidsOn(port) {
  if (process.platform === 'win32') {
    return [
      ...new Set(
        run('netstat -ano -p tcp')
          .split(/\r?\n/)
          .filter((l) => /LISTENING/i.test(l) && new RegExp(`[:.]${port}\\s`).test(l))
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((pid) => pid && pid !== '0'),
      ),
    ]
  }
  return run(`lsof -ti tcp:${port} -sTCP:LISTEN`).split(/\s+/).filter(Boolean)
}

let stopped = 0
for (const port of ports) {
  const pids = pidsOn(port)
  if (pids.length === 0) {
    console.log(`port ${port}: free`)
    continue
  }
  for (const pid of pids) {
    // /T also stops the watcher that would restart it.
    run(process.platform === 'win32' ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`)
    stopped++
    console.log(`port ${port}: stopped process ${pid}`)
  }
}
if (stopped > 0) console.log('Dev ports are free. Run: npm run dev')
