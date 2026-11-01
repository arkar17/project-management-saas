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
  /** Private S3-compatible attachment storage (ADR-004); MinIO locally. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** apps/worker needs the database and mail settings only (no HTTP or storage config). */
const workerEnvSchema = envSchema
  .pick({
    NODE_ENV: true,
    LOG_LEVEL: true,
    DATABASE_URL: true,
    APP_BASE_URL: true,
    SMTP_HOST: true,
    SMTP_PORT: true,
    SMTP_USER: true,
    SMTP_PASSWORD: true,
    MAIL_FROM: true,
  })
  .extend({ WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000) });
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Fails fast at startup with the names (never the values) of invalid variables. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parse(envSchema, source);
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parse(workerEnvSchema, source);
}

function parse<S extends z.ZodTypeAny>(schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${fields.join('\n  ')}`);
  }
  return parsed.data;
}
