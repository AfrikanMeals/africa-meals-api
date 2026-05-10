/**
 * Comptes clients utilisés uniquement pour les avis démo plats
 * (`ProductRatingsDemoSeedService`). À exclure des listes « vrais » avis client.
 */
export const DEMO_PRODUCT_RATER_EMAIL_RE =
  /^afrikan-demo-rating-[0-9]+@seed\.local$/i;

export function isDemoProductRaterEmail(email: unknown): boolean {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return e.length > 0 && DEMO_PRODUCT_RATER_EMAIL_RE.test(e);
}
