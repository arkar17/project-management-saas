import { z } from 'zod';

/** FR-AUTH-001: emails are trimmed and lower-cased before uniqueness checks. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.string().email().max(254));

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInput>;

export const tokenInput = z.object({ token: z.string().min(1).max(200) });
export type TokenInput = z.infer<typeof tokenInput>;

export const emailInput = z.object({ email: emailSchema });
export type EmailInput = z.infer<typeof emailInput>;

export const resetPasswordInput = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const authUserDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  timezone: z.string(),
  emailVerified: z.boolean(),
});
export type AuthUserDto = z.infer<typeof authUserDto>;

// ---- FR-AUTH-004 account self-service ----

export const updatePreferencesInput = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Must be a valid IANA timezone')
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

/** Re-authentication is required for deactivation. */
export const deactivateAccountInput = z.object({ password: z.string().min(1).max(128) });

/** CSRF double-submit (ADR-001): header must equal the non-HttpOnly cookie. */
export const CSRF_COOKIE = 'pm_csrf';
export const CSRF_HEADER = 'x-csrf-token';
