/**
 * Interprète le flag Region Check mobile.
 * Absent / null → activé (comportement historique).
 * Explicitement `false` → désactivé.
 */
export function isMobileRegionCheckEnabled(
  flag: boolean | null | undefined,
): boolean {
  return flag !== false;
}
