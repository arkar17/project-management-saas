import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createSmtpMailer } from './lib/mailer.js';
import { createPrisma } from './lib/prisma.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createPrisma(env.DATABASE_URL);
const mailer = createSmtpMailer({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
  from: env.MAIL_FROM,
});

const server = createApp({ env, db, mailer, logger }).listen(env.PORT, () => {
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
