import { z } from 'zod'
import { SUPPORTED_LOCALES } from '../locales.js'

/**
 * Password policy: 8+ chars, at least one letter and one digit.
 * Kept deliberately simple for restaurant staff; length is what matters.
 *
 * Custom messages in shared schemas are i18n keys (`validation.*`); the web
 * client translates them, so the same schema yields Hindi/Gujarati errors.
 */
export const passwordSchema = z
  .string()
  .min(8, 'validation.passwordMinLength')
  .max(128)
  .regex(/[A-Za-z]/, 'validation.passwordLetter')
  .regex(/[0-9]/, 'validation.passwordNumber')

/** Login accepts email, username or phone in a single field. */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
})
export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'validation.passwordSame',
    path: ['newPassword'],
  })
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

/** Web form variant: adds a confirmation field (not sent to the API). */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'validation.passwordMismatch',
    path: ['confirmPassword'],
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'validation.passwordSame',
    path: ['newPassword'],
  })
export type ChangePasswordFormInput = z.infer<typeof changePasswordFormSchema>

export const updatePreferencesSchema = z.object({
  preferredLocale: z.enum(SUPPORTED_LOCALES),
})
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES).optional(),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
