/**
 * Normalisation et validation du username profil (PATCH /auth/me).
 * Stockage toujours en minuscules pour l’unicité case-insensitive.
 */

/** Longueur min / max après normalisation. */
export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 30;

/**
 * Format : lettre en tête, puis lettres / chiffres / underscore uniquement.
 * Ex. `jean_dupont`, `livreur12`.
 */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;

/**
 * Trim + lowercase ; retire un éventuel préfixe `@` collé / collé.
 * Chaîne vide → `null` (effacement / non renseigné).
 */
export function normalizeUsername(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // UI affiche `@` en décoratif — ne jamais le persister.
  const trimmed = String(raw).trim().replace(/^@+/, '').toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * `true` si le username normalisé respecte le format métier.
 * Précondition : passer une valeur déjà normalisée (non vide).
 */
export function isValidUsernameFormat(normalized: string): boolean {
  return USERNAME_PATTERN.test(normalized);
}

/**
 * Message d’erreur stable pour ValidationPipe / BadRequestException.
 */
export function usernameFormatErrorMessage(): string {
  return `username_invalid_format (lettre puis a-z0-9_, ${USERNAME_MIN_LEN}–${USERNAME_MAX_LEN} car.)`;
}
