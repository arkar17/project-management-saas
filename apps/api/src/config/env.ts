import { z } from 'zod';

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  /** Origins allowed for CORS and the CSRF Origin check (ADR-001). */
  WEB_ORIGINS: csv,
  /** Base URL of the web app, used to build links in emails. */
  APP_BASE_URL: z.string().url(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast at startup with the names (never the values) of invalid variables. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${fields.join('\n  ')}`);
  }
  return parsed.data;
}
