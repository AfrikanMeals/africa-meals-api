import type { StorageMediaField } from './storage-media-inventory.constants';

/**
 * Réécriture d'une URL média (typiquement `MediasService.resolvePublicMediaUrl`).
 * Retourne `undefined` quand l'URL est vide ou inexploitable.
 */
export type MediaUrlRewrite = (url: string) => Promise<string | undefined>;

function readString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Calcule les `$set` Mongo à appliquer à un document pour aligner ses URLs médias
 * sur ce que l'API sert aujourd'hui (proxy `/medias/public/…` si bucket privé).
 *
 * Fonction pure : aucun accès base ni réseau, la réécriture est injectée. Les champs
 * inchangés sont omis pour ne pas toucher `updatedAt` sur des documents déjà bons.
 */
export async function buildDocumentMediaUrlUpdates(
  doc: Record<string, unknown>,
  fields: StorageMediaField[],
  rewrite: MediaUrlRewrite,
): Promise<Record<string, string>> {
  const updates: Record<string, string> = {};

  const apply = async (path: string, raw: unknown): Promise<void> => {
    const current = readString(raw);
    if (!current) return;
    const next = await rewrite(current);
    // Pas de `$set` si la réécriture est un no-op : évite un write inutile.
    if (!next || next === current) return;
    updates[path] = next;
  };

  for (const field of fields) {
    if (field.kind === 'scalar') {
      await apply(field.field, doc[field.field]);
      continue;
    }

    if (field.kind === 'stringArray') {
      const rows = doc[field.field];
      if (!Array.isArray(rows)) continue;
      // Index positionnel : `proof_photo_urls.0`, `proof_photo_urls.1`, …
      for (let i = 0; i < rows.length; i++) {
        await apply(`${field.field}.${i}`, rows[i]);
      }
      continue;
    }

    const rows = doc[field.arrayField];
    if (!Array.isArray(rows)) continue;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object') continue;
      await apply(
        `${field.arrayField}.${i}.${field.urlField}`,
        (row as Record<string, unknown>)[field.urlField],
      );
    }
  }

  return updates;
}
