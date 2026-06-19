import {
  detectEngineFromUrl,
  StorageEngineId,
} from '@modules/medias/storage-engine.types';

/** Moteur / emplacement effectif d’une image catalogue ou média chat. */
export type CatalogImageStorageKind =
  | StorageEngineId
  | 'db'
  | 'proxy'
  | 'external';

export function detectCatalogImageStorageKind(
  url: string | null | undefined,
  storedInDb = false,
): CatalogImageStorageKind | null {
  if (storedInDb) return 'db';
  const raw = (url ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) return 'db';
  if (raw.includes('/medias/public/')) return 'proxy';
  const engine = detectEngineFromUrl(raw);
  if (engine) return engine;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return 'external';
  return null;
}
