/**
 * Prix catalogue vendeur d’un item produit dans un combo (hors commission).
 * Aligné sur le panier : variante par défaut (ou 1ʳᵉ / label choisi) si présente.
 */

export type BundleCatalogVariantLike = {
  label?: string;
  name?: string;
  price?: number;
  discountPrice?: number;
  discount_price?: number;
  isDefault?: boolean;
  is_default?: boolean;
};

export type BundleCatalogProductLike = {
  price?: number;
  discountPrice?: number;
  discount_price?: number;
  variants?: BundleCatalogVariantLike[];
};

function variantEffectiveVendorPrice(v: BundleCatalogVariantLike): number {
  const vp = Math.max(0, Number(v.price ?? 0) || 0);
  const vd = Math.max(
    0,
    Number(v.discountPrice ?? v.discount_price ?? 0) || 0,
  );
  // Même règle que cart.service (promo variante si strictement inférieure).
  if (vd > 0 && vd < vp) return vd;
  return vp;
}

/**
 * Résout le prix vendeur de référence pour le pricing feed / panier combo.
 * @param preferredVariantLabel — label déjà choisi (sinon variante défaut / première).
 */
export function resolveBundleProductVendorUnitPrice(
  product: BundleCatalogProductLike | null | undefined,
  preferredVariantLabel?: string | null,
): number {
  if (!product) return 0;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const want = String(preferredVariantLabel ?? '').trim();

  if (variants.length > 0) {
    let match: BundleCatalogVariantLike | undefined;
    if (want) {
      match = variants.find((v) => {
        const label = String(v.label ?? v.name ?? '').trim();
        return label === want;
      });
    }
    if (!match) {
      match =
        variants.find((v) => Boolean(v.isDefault ?? v.is_default)) ??
        variants[0];
    }
    if (match) {
      return variantEffectiveVendorPrice(match);
    }
  }

  const dp = Number(product.discountPrice ?? product.discount_price) || 0;
  if (dp > 0) return dp;
  return Math.max(0, Number(product.price) || 0);
}
