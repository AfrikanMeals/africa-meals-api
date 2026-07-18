import {
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
  normalizeSelectedVariantLabel,
} from '@modules/cart/cart-customization.util';

/**
 * Normalise les champs perso d’une ligne commande pour l’API client.
 * Tolère camelCase / snake_case (lean Mongo vs getters Nest).
 */
export function normalizeOrderLineItemForApi(
  raw: unknown,
): Record<string, unknown> {
  const it =
    raw !== null && typeof raw === 'object'
      ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const complements = normalizeSelectedComplements(
    it.selectedComplements ?? it.selected_complements,
  );
  const supplements = normalizeSelectedSupplements(
    it.selectedSupplements ?? it.selected_supplements,
  );
  const variant = normalizeSelectedVariantLabel(
    it.selectedVariantLabel ?? it.selected_variant_label,
  );

  // Toujours exposer camelCase pour field-selection + clients admin/mobile.
  it.selectedComplements = complements;
  it.selectedSupplements = supplements;
  if (variant) {
    it.selectedVariantLabel = variant;
  } else {
    delete it.selectedVariantLabel;
  }
  delete it.selected_complements;
  delete it.selected_supplements;
  delete it.selected_variant_label;

  // Libellés combo / catégorie : même traitement snake → camel.
  if (it.categoryTitle == null && it.category_title != null) {
    it.categoryTitle = it.category_title;
  }
  if (it.pictureUrl == null && it.picture_url != null) {
    it.pictureUrl = it.picture_url;
  }
  if (it.bundleGroupId == null && it.bundle_group_id != null) {
    it.bundleGroupId = it.bundle_group_id;
  }
  if (it.bundleTitle == null && it.bundle_title != null) {
    it.bundleTitle = it.bundle_title;
  }
  if (it.itemType == null && it.item_type != null) {
    it.itemType = it.item_type;
  }

  return it;
}

/** Applique [normalizeOrderLineItemForApi] sur `order.items`. */
export function normalizeOrderItemsOnOrderRow(
  order: Record<string, unknown>,
): Record<string, unknown> {
  const items = order.items;
  if (!Array.isArray(items)) return order;
  return {
    ...order,
    items: items.map((line) => normalizeOrderLineItemForApi(line)),
  };
}

export function normalizeOrderItemsOnOrderRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => normalizeOrderItemsOnOrderRow(row));
}
