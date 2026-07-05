import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Password/secret hashing using Node's built-in scrypt — no external dependency.
// Format: scrypt$<saltHex>$<hashHex>

export function hashSecret(value: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(value, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(value: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(value, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
