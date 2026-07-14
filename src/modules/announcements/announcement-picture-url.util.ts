/**
 * Normalise pictureUrl pour $set Mongo sur create/update annonces.
 * - null / '' → null (efface l’image)
 * - URL non vide → trim
 */
export function applyAnnouncementPictureUrl(
  pictureUrl: string | null | undefined,
): string | null {
  if (pictureUrl == null) return null;
  const trimmed = String(pictureUrl).trim();
  return trimmed || null;
}
