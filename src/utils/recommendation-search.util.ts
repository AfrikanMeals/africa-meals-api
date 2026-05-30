import { createHash } from 'node:crypto';
import { Types } from 'mongoose';

/** Normalise une requête de recherche pour stockage / dédup / agrégation. */
export function normalizeRecommendationSearchTerm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Identifiant BSON stable par terme (pour index unique user/kind/refId + dédup),
 * sans exposer de faux ObjectId métier côté produit/boutique.
 */
export function searchTermToRefObjectId(normalized: string): Types.ObjectId {
  const digest = createHash('sha256').update(normalized, 'utf8').digest();
  const buf = Buffer.alloc(12);
  digest.copy(buf, 0, 0, 12);
  return new Types.ObjectId(buf);
}
