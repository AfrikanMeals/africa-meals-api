import { SearchContent } from './search.dto';

/** Normalise `searchContent` depuis query string ou tableau (Express / ValidationPipe). */
export function normalizeSearchContentQuery(
  value: unknown,
): SearchContent[] | undefined {
  if (value == null || value === '') return undefined;

  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry == null) continue;
      parts.push(...String(entry).split(','));
    }
  } else {
    parts.push(...String(value).split(','));
  }

  const out = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return out.length ? (out as SearchContent[]) : undefined;
}

/** Trim optionnel : ne touche qu’aux chaînes (évite `value.trim is not a function`). */
export function trimOptionalQueryString(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return String(value).trim() || undefined;
  const t = value.trim();
  return t.length ? t : undefined;
}

/** Nombre query optionnel (`0` est une valeur valide). */
export function parseOptionalQueryNumber(value: unknown): number | undefined {
  if (value === undefined || value === '' || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
