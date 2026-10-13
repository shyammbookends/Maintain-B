import { randomInt } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

/** Never throws: a malformed stored hash is treated as a mismatch. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | undefined

/**
 * Spend the same time as a real check when the account doesn't exist, so
 * response timing doesn't reveal which usernames/emails are registered.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equaliser-not-a-real-password-1')
  await verifyPassword(await dummyHash, password)
}

// No 0/O, 1/l/I: temporary passwords are often read aloud or copied by hand.
const TEMP_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const TEMP_DIGITS = '23456789'

/** 10-character temporary password with at least one letter and one digit (meets the policy). */
export function generateTemporaryPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)]!
  const chars = [pick(TEMP_LETTERS), pick(TEMP_DIGITS)]
  while (chars.length < 10) chars.push(pick(TEMP_LETTERS + TEMP_DIGITS))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
