import { createApp, DEFAULT_RATE_LIMITS } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPrisma } from './lib/prisma.js';
import { createS3Storage } from './lib/storage.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createPrisma(env.DATABASE_URL);

const storage = createS3Storage({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Browser E2E runs many sign-ins from one IP; NODE_ENV=test (never production) relaxes limits.
const relaxed = { windowMs: 60_000, limit: 10_000 };
const rateLimits =
  env.NODE_ENV === 'test'
    ? { login: relaxed, register: relaxed, email: relaxed, invite: relaxed }
    : DEFAULT_RATE_LIMITS;

const server = createApp({ env, db, logger, storage, rateLimits }).listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
