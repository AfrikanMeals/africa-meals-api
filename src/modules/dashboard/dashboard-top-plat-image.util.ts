/**
 * Choisit l’URL image d’un plat du top : photo ligne commande d’abord,
 * sinon lookup catalogue.
 */
export function resolveTopPlatDisplayImageUrl(opts: {
  orderPictureUrl?: string | null;
  catalogImageUrl?: string | null;
}): string | undefined {
  const fromOrder = String(opts.orderPictureUrl ?? '').trim();
  if (fromOrder) return fromOrder;
  const fromCatalog = String(opts.catalogImageUrl ?? '').trim();
  return fromCatalog || undefined;
}
