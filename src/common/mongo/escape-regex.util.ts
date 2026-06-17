/** Échappe les métacaractères pour requêtes MongoDB `$regex` (M-04). */
export function escapeMongoRegex(value: string): string {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCaseInsensitiveExactRegex(value: string): RegExp {
  return new RegExp(`^${escapeMongoRegex(value)}$`, 'i');
}
