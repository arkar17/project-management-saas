import {
  createLogger,
  createPrisma,
  createSmtpMailer,
  createWorker,
  loadWorkerEnv,
} from '@pm/api/worker';

// Outbox delivery and hourly jobs (ADR-005/018). Mail goes to Mailpit locally (SMTP_HOST/PORT).
const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createPrisma(env.DATABASE_URL);
const mailer = createSmtpMailer({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
  from: env.MAIL_FROM,
});

const worker = createWorker({
  db,
  mailer,
  logger,
  appBaseUrl: env.APP_BASE_URL,
  pollMs: env.WORKER_POLL_MS,
});
worker.start();
logger.info({ event: 'worker.started' }, 'worker started');

function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  worker.stop();
  void db.$disconnect().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
