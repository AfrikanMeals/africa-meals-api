import { timingSafeEqual } from 'crypto';

/** Comparaison de chaînes à durée constante (L-02). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
