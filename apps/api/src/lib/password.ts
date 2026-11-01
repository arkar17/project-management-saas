import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Literal value of the ambient const enum Algorithm.Argon2id (not importable as a value).
const ARGON2ID = 2 as Algorithm.Argon2id;

// OWASP-recommended Argon2id parameters (NFR-02).
const options = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

/** Burns the same work as a real check so unknown emails are not revealed by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verify(await dummyHash, password);
  return false;
}
