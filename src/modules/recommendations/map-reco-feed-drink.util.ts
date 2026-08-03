/**
 * Payload boisson allégé pour feed Home / shopHome.
 * Inclut discountPrice pour affichage promo (priceCad = catalogue inchangé).
 */
export function mapRecoFeedDrink(opts: {
  drink: {
    id?: unknown
    name?: unknown
    priceCad?: unknown
    discountPrice?: unknown
    imageUrl?: unknown
    storeId?: unknown
    quantite?: unknown
  }
  storeName?: string
}): Record<string, unknown> {
  const d = opts.drink
  const priceCad = Number(d.priceCad ?? 0)
  const discountRaw = Number(d.discountPrice ?? 0)
  // Promo active seulement si 0 < discount < priceCad (parité CatalogDrink / APP-TRACK).
  const discountPrice =
    Number.isFinite(discountRaw) && discountRaw > 0 && discountRaw < priceCad
      ? discountRaw
      : 0

  return {
    id: String(d.id ?? ''),
    name: String(d.name ?? ''),
    priceCad: Number.isFinite(priceCad) ? priceCad : 0,
    discountPrice,
    imageUrl: String(d.imageUrl ?? ''),
    storeId: String(d.storeId ?? ''),
    storeName: String(opts.storeName ?? ''),
    quantite: d.quantite,
  }
}
