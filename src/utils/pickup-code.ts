import { randomInt } from 'crypto';

/** Caractères lisibles (sans 0/O, 1/I/L). */
const PICKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code retrait boutique : 6 caractères (ex. `A1B0C2`). */
export function generatePickupCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += PICKUP_CODE_ALPHABET[randomInt(0, PICKUP_CODE_ALPHABET.length)]!;
  }
  return code;
}

export function normalizePickupCodeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
