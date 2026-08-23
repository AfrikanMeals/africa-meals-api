/** Header anti-indexation des JSON API (hôte apis.* ≠ pages vitrine). */
export const API_X_ROBOTS_TAG_VALUE = 'noindex, nofollow';

export const API_X_ROBOTS_TAG_HEADER = 'X-Robots-Tag';

/** True si la valeur impose noindex (idempotent si déjà posé). */
export function isNoindexRobotsTag(value: string | undefined): boolean {
  return /\bnoindex\b/i.test(String(value ?? ''));
}
