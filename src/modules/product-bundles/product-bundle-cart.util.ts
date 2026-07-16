/**
 * Construit les lignes panier d’un bundle (ordre + IDs) sans I/O.
 * Contrat : itemType product → productId ; drink → drinkId.
 */

export type BundleCartSourceItem = {
  itemType: string;
  productId?: unknown;
  drinkId?: unknown;
  sortOrder?: number;
};

export type BundleCartLinePlan = {
  itemIndex: number;
  type: 'product' | 'drink';
  itemId: string;
};

function stringifyId(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw !== null && 'toString' in raw) {
    return String((raw as { toString: () => string }).toString()).trim();
  }
  return String(raw).trim();
}

/**
 * Trie les items (sortOrder) et produit le plan d’ajout panier.
 * Ignore les items sans ID valide.
 */
export function planBundleCartLines(
  items: BundleCartSourceItem[],
): BundleCartLinePlan[] {
  const indexed = items.map((it, itemIndex) => ({ it, itemIndex }));
  indexed.sort((a, b) => {
    const sa = Number(a.it.sortOrder ?? a.itemIndex);
    const sb = Number(b.it.sortOrder ?? b.itemIndex);
    return sa - sb || a.itemIndex - b.itemIndex;
  });

  const out: BundleCartLinePlan[] = [];
  for (const { it, itemIndex } of indexed) {
    const kind = String(it.itemType ?? '').trim().toLowerCase();
    if (kind === 'drink') {
      const itemId = stringifyId(it.drinkId);
      if (!itemId) continue;
      out.push({ itemIndex, type: 'drink', itemId });
      continue;
    }
    const itemId = stringifyId(it.productId);
    if (!itemId) continue;
    out.push({ itemIndex, type: 'product', itemId });
  }
  return out;
}
