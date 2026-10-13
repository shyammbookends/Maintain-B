import {
  API_KEY_PREFIX,
  ERROR_CODES,
  type ApiKeyDto,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type Permission,
} from '@maintainx/shared'
import { createHash, randomBytes } from 'node:crypto'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { NotFoundError, UnauthenticatedError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import { buildAuthContext, type AuthContext } from '../auth/auth.context.js'
import { loadUser } from '../auth/auth.repository.js'

/*
 * API keys for integrations. The key ("mx_live_" + 40 random characters) is
 * shown once; only its SHA-256 is stored. A request with the key acts as the
 * person who created it, limited to the key's scopes and their restaurants.
 */

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')
const MAX_KEYS = 20
/** lastUsedAt is written at most this often per key. */
const TOUCH_EVERY_MS = 5 * 60_000

const select = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const

type Row = { [K in keyof typeof select]: unknown } & {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  createdBy: { id: string; firstName: string; lastName: string }
}

const toDto = (k: Row): ApiKeyDto => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes as Permission[],
  createdBy: k.createdBy,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  expiresAt: k.expiresAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
})

export async function listApiKeys(auth: AuthContext): Promise<ApiKeyDto[]> {
  const rows = await prisma.apiKey.findMany({
    where: { organizationId: auth.organizationId },
    select,
    orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
  })
  return rows.map((r) => toDto(r as Row))
}

export async function createApiKey(
  auth: AuthContext,
  input: CreateApiKeyInput,
  req: Request,
): Promise<CreatedApiKey> {
  // A key can never do more than the person creating it.
  const outside = input.scopes.filter((p) => !auth.isSuperAdmin && !auth.permissions.has(p))
  if (outside.length) throw new ValidationError({ scopes: ['validation.permissionNotHeld'] })
  const active = await prisma.apiKey.count({
    where: { organizationId: auth.organizationId, revokedAt: null },
  })
  if (active >= MAX_KEYS) throw new ValidationError({ name: ['validation.tooMany'] })

  const key = `${API_KEY_PREFIX}${randomBytes(30).toString('base64url')}`
  const created = await prisma.apiKey.create({
    data: {
      organizationId: auth.organizationId,
      name: input.name,
      prefix: key.slice(0, API_KEY_PREFIX.length + 4),
      hash: hashKey(key),
      scopes: [...new Set(input.scopes)],
      createdById: auth.userId,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
    },
    select,
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'api_key.created',
      entityType: 'SETTING',
      entityId: created.id,
      newValue: { name: input.name, scopes: input.scopes },
    },
    req,
  )
  return { ...toDto(created as Row), key }
}

export async function revokeApiKey(auth: AuthContext, id: string, req: Request) {
  const done = await prisma.apiKey.updateMany({
    where: { id, organizationId: auth.organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (!done.count) throw new NotFoundError('API key')
  await recordAudit(
    {
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'api_key.revoked',
      entityType: 'SETTING',
      entityId: id,
    },
    req,
  )
  return listApiKeys(auth)
}

/** Resolves an API key to the request's AuthContext (creator, narrowed to the key's scopes). */
export async function authenticateApiKey(key: string): Promise<AuthContext> {
  const invalid = () =>
    new UnauthenticatedError(ERROR_CODES.TOKEN_INVALID, 'This API key is not valid.')
  const row = await prisma.apiKey.findUnique({ where: { hash: hashKey(key) } })
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) throw invalid()
  const loaded = await loadUser(row.createdById)
  if (
    !loaded ||
    loaded.record.organizationId !== row.organizationId ||
    loaded.record.status !== 'ACTIVE' ||
    loaded.record.archivedAt
  )
    throw invalid()
  const base = buildAuthContext(loaded.authUser, loaded.orgRestaurantIds)
  const scopes = new Set(row.scopes as Permission[])
  const allowed = [...scopes].filter((p) => base.isSuperAdmin || base.permissions.has(p))
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS)
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
  return {
    ...base,
    // Keys never get the Super Admin bypass: only their scopes count.
    isSuperAdmin: false,
    permissions: new Set(allowed),
    apiKeyId: row.id,
  }
}
