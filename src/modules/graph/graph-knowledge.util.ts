/** Heuristiques knowledge graph (Phase 5) — dérivé texte produit, pas SoT. */

export type DerivedProductTag =
  | 'vegan'
  | 'vegetarian'
  | 'halal'
  | 'gluten_free'
  | 'spicy'
  | 'nuts'
  | 'dairy'
  | 'seafood';

const TAG_PATTERNS: Array<{ tag: DerivedProductTag; re: RegExp }> = [
  { tag: 'vegan', re: /\bvegan\b|\bvégan\b|\bvégétarien\s*strict\b/i },
  {
    tag: 'vegetarian',
    re: /\bvegetarian\b|\bvégétarien\b|\bveggie\b/i,
  },
  { tag: 'halal', re: /\bhalal\b|\bحلال\b/i },
  {
    tag: 'gluten_free',
    re: /\bgluten[\s-]?free\b|\bsans\s+gluten\b/i,
  },
  { tag: 'spicy', re: /\bspicy\b|\bpiquant\b|\bhot\b|\bchili\b/i },
  {
    tag: 'nuts',
    re: /\bnuts?\b|\bpeanut\b|\bamande\b|\bcacahu[eè]te\b|\bnoix\b/i,
  },
  {
    tag: 'dairy',
    re: /\bdairy\b|\blait\b|\bfromage\b|\bcheese\b|\bcream\b|\bcr[eè]me\b/i,
  },
  {
    tag: 'seafood',
    re: /\bseafood\b|\bfish\b|\bpoisson\b|\bshrimp\b|\bcrevette\b|\bcrab\b/i,
  },
];

export function deriveProductTagsFromText(
  parts: Array<string | undefined | null>,
): DerivedProductTag[] {
  const hay = parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' \n ');
  if (!hay) return [];
  const out = new Set<DerivedProductTag>();
  for (const { tag, re } of TAG_PATTERNS) {
    if (re.test(hay)) out.add(tag);
  }
  return [...out];
}

export function zoneIdFromShippingRing(
  storeId: string,
  minKm: number,
  maxKm: number,
): string {
  const a = Number.isFinite(minKm) ? minKm : 0;
  const b = Number.isFinite(maxKm) ? maxKm : a;
  return `${storeId}:${a.toFixed(1)}-${b.toFixed(1)}`;
}
