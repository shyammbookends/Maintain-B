/*
 * Guards for the seed scripts. Their default passwords are public (they are in
 * the repository), so they must never create working logins on a real site.
 */

/** Passwords published in this repository: refused for any hosted database. */
export const PUBLIC_DEFAULT_PASSWORDS = ['ChangeMe123', 'Demo@1234']

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db', 'host.docker.internal'])

function isPrivateHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost')) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * True when the seed may be talking to a real (hosted) database: production,
 * Vercel, or any DATABASE_URL that isn't on this machine / a private network.
 * Running `npm run db:seed` locally against the Supabase URL counts as hosted.
 */
export function isHostedDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production' || env.VERCEL) return true
  const url = env.DATABASE_URL
  if (!url) return false
  try {
    return !isPrivateHost(new URL(url).hostname.toLowerCase())
  } catch {
    return true
  }
}

/**
 * The first Super Admin's password on a hosted database must be given
 * explicitly (SEED_ADMIN_PASSWORD), be a real password and not a published
 * default. Returns the problem, or null when it's acceptable.
 */
export function hostedAdminPasswordProblem(password: string | undefined): string | null {
  if (!password) return 'SEED_ADMIN_PASSWORD is not set'
  if (PUBLIC_DEFAULT_PASSWORDS.includes(password)) return 'SEED_ADMIN_PASSWORD is a published default'
  if (password.length < 12) return 'SEED_ADMIN_PASSWORD must be at least 12 characters on a hosted database'
  return null
}

/**
 * Demo logins (shared password) only on a local database, unless explicitly
 * forced with ALLOW_DEMO_SEED=yes-i-understand (e.g. a throwaway demo site).
 */
export function demoSeedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production' || env.VERCEL) return false
  return !isHostedDatabase(env) || env.ALLOW_DEMO_SEED === 'yes-i-understand'
}
