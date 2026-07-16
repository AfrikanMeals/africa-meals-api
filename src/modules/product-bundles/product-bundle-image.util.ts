/**
 * Normalise l’URL de couverture bundle.
 * Contrat : string non vide trimée, ou `undefined` (pas de `""` en base).
 */
export function normalizeBundleCoverImage(
  image: string | null | undefined,
): string | undefined {
  if (image === null || image === undefined) return undefined;
  const trimmed = String(image).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Extensions image acceptées pour l’upload couverture bundle. */
export function isAllowedBundleImageFilename(filename: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(filename.trim());
}
