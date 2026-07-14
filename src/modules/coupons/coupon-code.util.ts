/**
 * Valide un code promo boutique : préfixe obligatoire `AM-` + suffixe alphanum.
 * Aligné sur la génération admin (`AM-` + 8 caractères typiquement).
 */
export function isStoreCouponCodeWithAmPrefix(raw: string): boolean {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^AM-[A-Z0-9]{6,36}$/.test(code);
}
