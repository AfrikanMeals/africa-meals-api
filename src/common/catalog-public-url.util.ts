/** URLs vitrine catalogue — alignées sur africa-meals-web (slugify id + "-" + name). */

export function slugifyCatalogSegment(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function storePublicSlug(storeId: string, storeName?: string | null): string {
  const id = String(storeId ?? '').trim();
  const name = String(storeName ?? '').trim();
  if (!id) return '';
  if (!name) return id;
  return slugifyCatalogSegment(`${id}-${name}`);
}

export function productPublicSlug(
  productId: string,
  productTitle?: string | null,
): string {
  const id = String(productId ?? '').trim();
  const title = String(productTitle ?? '').trim();
  if (!id) return '';
  if (!title) return id;
  return slugifyCatalogSegment(`${id}-${title}`);
}

export function storePublicPath(storeId: string, storeName?: string | null): string {
  const segment = storePublicSlug(storeId, storeName);
  return segment ? `/stores/${segment}` : '/stores/';
}

export function productPublicPath(
  storeId: string,
  productId: string,
  storeName?: string | null,
  productTitle?: string | null,
): string {
  const productSegment = productPublicSlug(productId, productTitle);
  if (!productSegment) {
    return `${storePublicPath(storeId, storeName)}/products/`;
  }
  return `${storePublicPath(storeId, storeName)}/products/${productSegment}`;
}

export function resolveStorePublicUrl(
  publicWebUrl: string,
  storeId: string,
  storeName?: string | null,
): string {
  const root = publicWebUrl.trim().replace(/\/+$/, '');
  return `${root}${storePublicPath(storeId, storeName)}`;
}

export function resolveProductPublicUrl(
  publicWebUrl: string,
  storeId: string,
  productId: string,
  storeName?: string | null,
  productTitle?: string | null,
): string {
  const root = publicWebUrl.trim().replace(/\/+$/, '');
  return `${root}${productPublicPath(storeId, productId, storeName, productTitle)}`;
}

export function resolveDrinkPublicUrl(
  publicWebUrl: string,
  storeId: string,
  drinkId: string,
  storeName?: string | null,
): string {
  const root = publicWebUrl.trim().replace(/\/+$/, '');
  const drinkSegment = encodeURIComponent(String(drinkId ?? '').trim());
  return `${root}${storePublicPath(storeId, storeName)}/drinks/${drinkSegment}`;
}
