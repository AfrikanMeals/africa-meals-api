import { Types } from 'mongoose';

/** Extrait un ObjectId Mongo depuis un segment public (`id` ou `id-nom-slug`). */
export function resolveMongoIdFromPublicParam(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (Types.ObjectId.isValid(raw) && /^[a-f0-9]{24}$/i.test(raw)) {
    return raw;
  }
  const match = raw.match(/^([a-f0-9]{24})(?:-.*)?$/i);
  if (!match) return null;
  const id = match[1];
  return Types.ObjectId.isValid(id) ? id : null;
}

export function clientPlatformFromRequest(
  req: { headers?: Record<string, string | string[] | undefined> },
): string {
  const raw = req.headers?.['x-client-platform'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value ?? '').trim().toLowerCase();
}

/** Vitrine web publique : pas de filtre région (liens partagés multi-régions). */
export function shouldApplyCatalogRegionFilter(
  clientPlatform: string | undefined,
  _countryCode?: string | undefined,
): boolean {
  return String(clientPlatform ?? '').toLowerCase() !== 'web';
}
