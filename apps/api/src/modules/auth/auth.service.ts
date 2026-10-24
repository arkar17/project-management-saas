import type { AuthUserDto, LoginInput, RegisterInput, ResetPasswordInput } from '@pm/shared';
import { Prisma, type SessionKind, type User, type VerificationTokenKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { AppError, tokenExpired } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import type { Db } from '../../lib/prisma.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import type { SessionMeta, SessionService } from './session.service.js';

const HOUR = 60 * 60 * 1000;
const TOKEN_TTL: Record<VerificationTokenKind, number> = {
  EMAIL_VERIFY: 24 * HOUR,
  PASSWORD_RESET: HOUR,
};

export interface AuthDeps {
  db: Db;
  sessions: SessionService;
  mailer: Mailer;
  logger: Logger;
  appBaseUrl: string;
}

export function toAuthUser(user: User): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    emailVerified: user.verifiedAt !== null,
  };
}

/** Correlates log lines for one email without writing the address itself to logs. */
const emailRef = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 16);

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export function createAuthService({ db, sessions, mailer, logger, appBaseUrl }: AuthDeps) {
  /** Invalidates outstanding tokens of the same kind, then issues a fresh single-use token. */
  async function issueToken(userId: string, kind: VerificationTokenKind): Promise<string> {
    const token = newToken();
    await db.$transaction([
      db.verificationToken.updateMany({
        where: { userId, kind, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      db.verificationToken.create({
        data: {
          userId,
          kind,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL[kind]),
        },
      }),
    ]);
    return token;
  }

  /** Atomically consumes a token; a second use, wrong kind or expiry all yield 410. */
  async function consumeToken(token: string, kind: VerificationTokenKind) {
    const record = await db.verificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.kind !== kind) throw tokenExpired();
    const { count } = await db.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw tokenExpired();
    return record.userId;
  }

  async function sendVerification(user: Pick<User, 'id' | 'email'>) {
    const token = await issueToken(user.id, 'EMAIL_VERIFY');
    await mailer.send({
      to: user.email,
      subject: 'Verify your email',
      text: `Confirm your email address: ${appBaseUrl}/verify-email?token=${token}\nThis link expires in 24 hours.`,
    });
  }

  return {
    /** FR-AUTH-001: identical outcome for new and existing emails (account-neutral). */
    async register(input: RegisterInput): Promise<void> {
      const passwordHash = await hashPassword(input.password);
      const existing = await db.user.findUnique({ where: { email: input.email } });
      if (existing) {
        await mailer.send({
          to: existing.email,
          subject: 'You already have an account',
          text: `Someone tried to register with this email. Sign in at ${appBaseUrl}/login or reset your password at ${appBaseUrl}/forgot-password.`,
        });
        return;
      }
      try {
        const user = await db.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });
        await sendVerification(user);
      } catch (err) {
        // A concurrent registration won the unique email; keep the response account-neutral.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
      }
    },

    async verifyEmail(token: string): Promise<void> {
      const userId = await consumeToken(token, 'EMAIL_VERIFY');
      await db.user.updateMany({
        where: { id: userId, verifiedAt: null },
        data: { verifiedAt: new Date() },
      });
    },

    /** FR-AUTH-006: account-neutral; previous verification tokens are invalidated. */
    async resendVerification(email: string): Promise<void> {
      const user = await db.user.findUnique({ where: { email } });
      if (user && user.status === 'ACTIVE' && !user.verifiedAt) await sendVerification(user);
    },

    /**
     * Verifies credentials and opens a session of the requested kind, revoking the session
     * presented with the request so the identifier always rotates on login (ADR-001).
     * PLATFORM sessions additionally require an ACTIVE PlatformAdmin record (ADR-007).
     */
    async login(
      input: LoginInput,
      kind: SessionKind,
      meta: SessionMeta & { previousToken?: string | undefined },
    ) {
      const user = await db.user.findUnique({
        where: { email: input.email },
        include: { platformAdmin: true },
      });
      const passwordOk = user
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      const allowed =
        user !== null &&
        passwordOk &&
        user.status === 'ACTIVE' &&
        (kind === 'APP' || user.platformAdmin?.status === 'ACTIVE');

      if (!user || !allowed) {
        logger.warn({ event: 'auth.login_failed', kind, emailRef: emailRef(input.email) });
        throw invalidCredentials();
      }
      if (meta.previousToken) await sessions.revokeToken(meta.previousToken);
      const session = await sessions.create(user.id, kind, meta);
      return { user, session };
    },

    async forgotPassword(email: string): Promise<void> {
      const user = await db.user.findUnique({ where: { email } });
      if (!user || user.status !== 'ACTIVE') return;
      const token = await issueToken(user.id, 'PASSWORD_RESET');
      await mailer.send({
        to: user.email,
        subject: 'Reset your password',
        text: `Reset your password: ${appBaseUrl}/reset-password?token=${token}\nThis link expires in 1 hour. If you did not request it, ignore this email.`,
      });
    },

    /** FR-AUTH-003: single-use 1 h token; every session of the user is revoked. */
    async resetPassword(input: ResetPasswordInput): Promise<void> {
      const userId = await consumeToken(input.token, 'PASSWORD_RESET');
      const passwordHash = await hashPassword(input.password);
      await db.user.update({ where: { id: userId }, data: { passwordHash } });
      await sessions.revokeAllForUser(userId);
    },

    async getUser(userId: string): Promise<User> {
      return db.user.findUniqueOrThrow({ where: { id: userId } });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
