/**
 * Helpers purs pour items campagne type BUNDLE (productBundleId).
 * Évite de dupliquer la logique de clé / normalisation dans le service.
 */

export type CampaignBundleItemInput = {
  itemType: string;
  productBundleId?: string | null;
};

/** Clé unique pour dédupliquer un item BUNDLE dans une campagne. */
export function campaignBundleItemKey(productBundleId: string): string {
  return `B:${productBundleId.trim()}`;
}

/** True si l’item est un BUNDLE avec un productBundleId non vide. */
export function isCampaignBundleItem(
  it: CampaignBundleItemInput,
): it is CampaignBundleItemInput & { productBundleId: string } {
  return (
    String(it.itemType ?? '').trim().toUpperCase() === 'BUNDLE' &&
    String(it.productBundleId ?? '').trim().length > 0
  );
}
