/**
 * Stratégie de filtre texte catalogue : ES (IDs) → regex Mongo → vide.
 */
export type CatalogTextSearchMode = 'elasticsearch' | 'regex' | 'empty';

export function resolveCatalogTextSearchMode(opts: {
  elasticsearchSearchEnabled: boolean;
  regexSearchEnabled: boolean;
  /** IDs renvoyés par ES (peut être vide si aucun match). */
  elasticsearchHitCount: number;
  /** true si l’appel ES a été tenté (cluster OK). false = skip ES / erreur. */
  elasticsearchAttempted: boolean;
}): CatalogTextSearchMode {
  if (
    opts.elasticsearchSearchEnabled &&
    opts.elasticsearchAttempted &&
    opts.elasticsearchHitCount > 0
  ) {
    return 'elasticsearch';
  }
  if (
    opts.elasticsearchSearchEnabled &&
    opts.elasticsearchAttempted &&
    opts.elasticsearchHitCount === 0 &&
    !opts.regexSearchEnabled
  ) {
    return 'empty';
  }
  if (opts.regexSearchEnabled) return 'regex';
  if (opts.elasticsearchSearchEnabled && !opts.elasticsearchAttempted) {
    return 'empty';
  }
  return 'empty';
}

export function toObjectIdStrings(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || id.length !== 24 || seen.has(id)) continue;
    if (!/^[a-fA-F0-9]{24}$/.test(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
