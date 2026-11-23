import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = config.encryptionAlgorithm;
const KEY = Buffer.from(config.encryptionKey.padEnd(32, '0').slice(0, 32), 'utf8');
const IV_LENGTH = 12; // GCM uses 12-byte IV
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/**
 * Encrypt an object (JSON stringify + encrypt)
 */
export function encryptObject<T>(obj: T): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt to an object (decrypt + JSON parse)
 */
export function decryptObject<T>(encrypted: string): T {
  return JSON.parse(decrypt(encrypted));
}

/**
 * Generate a secure random string
 */
export function generateSecureRandom(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Generate a secure API key
 */
export function generateApiKey(prefix: string = 'pulse'): { key: string; hash: string; keyPrefix: string } {
  const randomPart = generateSecureRandom(24);
  const key = `${prefix}_${randomPart}`;
  const hash = hashApiKey(key);
  const keyPrefix = `${prefix}_${randomPart.slice(0, 8)}`;
  return { key, hash, keyPrefix };
}

/**
 * Hash an API key for storage
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Verify an API key against its hash
 */
export function verifyApiKey(key: string, hash: string): boolean {
  return hashApiKey(key) === hash;
}

/**
 * Hash a token (for sessions, refresh tokens, etc.)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a device fingerprint
 */
export function generateDeviceFingerprint(userAgent: string, ip: string): string {
  const data = `${userAgent}|${ip}|${config.encryptionKey}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Constant-time string comparison
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a secure correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `corr_${generateSecureRandom(16)}`;
}

/**
 * Generate a secure request ID
 */
export function generateRequestId(): string {
  return `req_${generateSecureRandom(12)}`;
}

/**
 * Hash password with Argon2 (using crypto for now, replace with argon2 in production)
 */
export async function hashPassword(password: string): Promise<string> {
  // Using PBKDF2 as fallback, replace with argon2 in production
  const salt = crypto.randomBytes(32);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return `$pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const parts = hash.split('$');
    if (parts.length !== 5 || parts[1] !== 'pbkdf2') {
      return false;
    }

    const iterations = parseInt(parts[2], 10);
    const salt = Buffer.from(parts[3], 'base64');
    const expectedHash = Buffer.from(parts[4], 'base64');

    const actualHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512');
    return timingSafeEqual(actualHash.toString('base64'), expectedHash.toString('base64'));
  } catch {
    return false;
  }
}

/**
 * Generate MFA secret (base32)
 */
export function generateMfaSecret(): string {
  const buffer = crypto.randomBytes(20);
  return buffer.toString('base32').replace(/=/g, '');
}

/**
 * Generate MFA backup codes
 */
export function generateMfaBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

/**
 * Hash MFA backup code
 */
export function hashMfaBackupCode(code: string): string {
  return crypto.createHash('sha256').update(code.toLowerCase()).digest('hex');
}

/**
 * Verify MFA backup code
 */
export function verifyMfaBackupCode(code: string, hash: string): boolean {
  return hashMfaBackupCode(code) === hash;
}