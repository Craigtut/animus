/**
 * Password Generator — cryptographically secure password generation.
 *
 * Uses Web Crypto API (crypto.getRandomValues) for randomness, which works
 * in both Node.js 24+ and all modern browsers. Never uses Math.random().
 */

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

export interface PasswordOptions {
  /** Password length (8-128, default 32) */
  length?: number;
  /** Exclude special characters (default false) */
  excludeSymbols?: boolean;
}

/**
 * Pick a random character from a character set using crypto-secure randomness.
 */
function randomChar(charset: string): string {
  // Use rejection sampling to avoid modulo bias
  const max = 256 - (256 % charset.length);
  const buf = new Uint8Array(1);
  let byte: number;
  do {
    crypto.getRandomValues(buf);
    byte = buf[0]!;
  } while (byte >= max);
  return charset[byte % charset.length]!;
}

/**
 * Shuffle an array in-place using Fisher-Yates with crypto randomness.
 */
function cryptoShuffle(arr: string[]): void {
  const buf = new Uint8Array(1);
  for (let i = arr.length - 1; i > 0; i--) {
    const max = 256 - (256 % (i + 1));
    let byte: number;
    do {
      crypto.getRandomValues(buf);
      byte = buf[0]!;
    } while (byte >= max);
    const j = byte % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * Generate a cryptographically secure password.
 *
 * Guarantees at least one character from each required set
 * (uppercase, lowercase, digit, and optionally symbol).
 */
export function generatePassword(options?: PasswordOptions): string {
  const length = Math.max(8, Math.min(128, options?.length ?? 32));
  const excludeSymbols = options?.excludeSymbols ?? false;

  const charsets = [UPPERCASE, LOWERCASE, DIGITS];
  if (!excludeSymbols) charsets.push(SYMBOLS);

  const fullCharset = charsets.join('');

  // Guarantee at least one from each required set
  const chars: string[] = charsets.map((cs) => randomChar(cs));

  // Fill the rest from the full charset
  for (let i = chars.length; i < length; i++) {
    chars.push(randomChar(fullCharset));
  }

  // Shuffle so guaranteed chars aren't always at the start
  cryptoShuffle(chars);

  return chars.join('');
}
