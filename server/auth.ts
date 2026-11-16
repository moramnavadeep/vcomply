import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number) => Promise<Buffer>;

const KEY_LENGTH = 64;
const TOKEN_LIFETIME = '30d';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Hashes a password with scrypt and a per-user random salt.
 * Stored as "scrypt$<salt hex>$<hash hex>" so the scheme can be changed later.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  // Constant-time comparison, so response time does not leak how much of the hash matched.
  return timingSafeEqual(actual, expected);
}

export function signToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: TOKEN_LIFETIME, algorithm: 'HS256' });
}

/** Returns the user id inside a valid, unexpired token, or null. */
export function verifyToken(token: string, secret: string): string | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Unguessable token for the calendar feed URL, which calendar apps fetch without a login. */
export function newFeedToken(): string {
  return randomBytes(24).toString('base64url');
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isAcceptablePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}
