import { z } from 'zod'
import { RESTAURANT_STATUS, USER_STATUS } from '../enums.js'
import { looksLikePhone } from '../phone.js'
import { passwordSchema } from './auth.js'
import { paginationQuerySchema, sortQuerySchema } from './common.js'

/*
 * Administration inputs (users, roles, teams, restaurants). Custom messages are
 * i18n keys (`validation.*`) that the web client translates.
 * Optional text fields accept '' from forms; the API stores '' as null.
 */

const optionalText = (max: number) => z.string().trim().max(max)

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'validation.invalidEmail')

export const optionalUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || /^[a-z0-9._-]{3,32}$/.test(v), 'validation.username')

export const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || looksLikePhone(v), 'validation.phone')

const userProfileShape = {
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: optionalEmailSchema,
  username: optionalUsernameSchema,
  phone: optionalPhoneSchema,
  /** e.g. "Refrigeration technician"; omitted = unchanged. */
  jobTitle: z.string().trim().max(80).optional(),
  /** Labour cost per hour in rupees ('' = not set); omitted = unchanged. Not self-editable. */
  hourlyRate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{1,6}(\.\d{1,2})?$/.test(v), 'validation.invalidNumber')
    .optional(),
}

const hasIdentifier = (v: { email: string; username: string; phone: string }) =>
  v.email !== '' || v.username !== '' || v.phone !== ''

const identifierRequired = {
  message: 'validation.identifierRequired',
  path: ['email'],
}

export const createUserSchema = z
  .object({
    ...userProfileShape,
    roleId: z.uuid(),
    restaurantIds: z.array(z.uuid()).max(200),
    /** Empty = the server generates a temporary password. */
    password: passwordSchema.or(z.literal('')),
  })
  .refine(hasIdentifier, identifierRequired)
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z.object(userProfileShape).refine(hasIdentifier, identifierRequired)
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const updateUserAccessSchema = z.object({
  roleId: z.uuid(),
  restaurantIds: z.array(z.uuid()).max(200),
})
export type UpdateUserAccessInput = z.infer<typeof updateUserAccessSchema>

export const setUserStatusSchema = z.object({
  status: z.enum(USER_STATUS).exclude(['INVITED']),
})
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>

export const USER_SORT_FIELDS = ['name', 'createdAt', 'lastLoginAt'] as const

export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(USER_SORT_FIELDS),
  status: z.enum(USER_STATUS).optional(),
  roleId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
})
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>

export const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  /** null = organization-wide team (Super Admin only). */
  restaurantId: z.uuid().nullable(),
  leadUserId: z.uuid().nullable(),
  memberIds: z.array(z.uuid()).max(500),
})
export type TeamInput = z.infer<typeof teamSchema>

const timeOfDay = z
  .string()
  .trim()
  .refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'validation.invalidValue')

export const restaurantSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, 'validation.restaurantCode'),
  name: z.string().trim().min(2).max(120),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  opensAt: timeOfDay,
  closesAt: timeOfDay,
  status: z.enum(RESTAURANT_STATUS),
  /** Person in charge on site; '' = none, omitted = unchanged. */
  managerId: z.uuid().or(z.literal('')).optional(),
  contactName: optionalText(120).optional(),
})
export type RestaurantInput = z.infer<typeof restaurantSchema>

export const listRestaurantsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(RESTAURANT_STATUS).optional(),
})
