import { CSRF_COOKIE, CSRF_HEADER } from '@pm/shared';
import { Writable } from 'node:stream';
import { createApp, DEFAULT_RATE_LIMITS, type AppDeps } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import type { Mail, Mailer } from '../src/lib/mailer.js';
import { createPrisma, type Db } from '../src/lib/prisma.js';

export const ORIGIN = 'http://localhost:5173';

/** Test double for the external email provider; records what would be delivered. */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
  last(to?: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => !to || m.to === to);
  }
  tokenFrom(mail: Mail | undefined): string {
    const token = mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error('no token in mail');
    return token;
  }
}

/** Captures JSON log lines so tests can assert on redaction. */
export function memoryLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger('info', stream), lines };
}

export function buildApp(overrides: Partial<AppDeps> & { db: Db }) {
  const mailer = new MemoryMailer();
  const { logger, lines } = memoryLogger();
  const app = createApp({
    env: { WEB_ORIGINS: [ORIGIN], APP_BASE_URL: ORIGIN, TRUST_PROXY: 0 },
    mailer,
    logger,
    rateLimits: DEFAULT_RATE_LIMITS,
    ...overrides,
  });
  return { app, mailer, logs: lines };
}

/** Prisma client that is never connected; any accidental query fails loudly. */
export function offlineDb(): Db {
  return createPrisma('postgresql://offline:offline@127.0.0.1:1/offline');
}

/** Valid double-submit CSRF headers (ADR-001). */
export function csrf(extraCookies: string[] = []) {
  const token = 'test-csrf-token';
  return {
    Origin: ORIGIN,
    [CSRF_HEADER]: token,
    Cookie: [`${CSRF_COOKIE}=${token}`, ...extraCookies].join('; '),
  };
}
