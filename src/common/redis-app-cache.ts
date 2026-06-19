import { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { UserModel } from '@schemas/user.schema';

/** TTL par défaut des réponses publiques catalogue / recherche (ms). */
export function parseCacheTtlMs(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

type RuntimeCacheTtlOverrides = {
  publicCatalogTtlMs?: number;
  favoritesTtlMs?: number;
  productCategoriesTtlMs?: number;
  checkoutPreviewTtlMs?: number;
};

let runtimeCacheTtlOverrides: RuntimeCacheTtlOverrides = {};

/** Applique les TTL admin (Mongo) — prioritaire sur les variables d’environnement. */
export function setRuntimeCacheTtlOverrides(
  overrides: RuntimeCacheTtlOverrides,
): void {
  runtimeCacheTtlOverrides = {
    publicCatalogTtlMs:
      overrides.publicCatalogTtlMs != null &&
      Number.isFinite(overrides.publicCatalogTtlMs) &&
      overrides.publicCatalogTtlMs > 0
        ? Math.trunc(overrides.publicCatalogTtlMs)
        : undefined,
    favoritesTtlMs:
      overrides.favoritesTtlMs != null &&
      Number.isFinite(overrides.favoritesTtlMs) &&
      overrides.favoritesTtlMs > 0
        ? Math.trunc(overrides.favoritesTtlMs)
        : undefined,
    productCategoriesTtlMs:
      overrides.productCategoriesTtlMs != null &&
      Number.isFinite(overrides.productCategoriesTtlMs) &&
      overrides.productCategoriesTtlMs > 0
        ? Math.trunc(overrides.productCategoriesTtlMs)
        : undefined,
    checkoutPreviewTtlMs:
      overrides.checkoutPreviewTtlMs != null &&
      Number.isFinite(overrides.checkoutPreviewTtlMs) &&
      overrides.checkoutPreviewTtlMs > 0
        ? Math.trunc(overrides.checkoutPreviewTtlMs)
        : undefined,
  };
}

export function apiPublicCacheTtlMs(raw?: string): number {
  const override = runtimeCacheTtlOverrides.publicCatalogTtlMs;
  if (override != null) return override;
  return parseCacheTtlMs(raw ?? process.env.API_PUBLIC_CACHE_TTL_MS, 90_000);
}

export function favoritesCacheTtlMs(raw?: string): number {
  const override = runtimeCacheTtlOverrides.favoritesTtlMs;
  if (override != null) return override;
  return parseCacheTtlMs(raw ?? process.env.FAVORITES_CACHE_TTL_MS, 25_000);
}

export function productCategoriesCacheTtlMs(raw?: string): number {
  const override = runtimeCacheTtlOverrides.productCategoriesTtlMs;
  if (override != null) return override;
  return parseCacheTtlMs(
    raw ?? process.env.PRODUCT_CATEGORIES_CACHE_TTL_MS,
    120_000,
  );
}

/** TTL preview pricing panier / checkout (ms) — court, invalidé à chaque mutation panier. */
export function checkoutPreviewCacheTtlMs(raw?: string): number {
  const override = runtimeCacheTtlOverrides.checkoutPreviewTtlMs;
  if (override != null) return override;
  return parseCacheTtlMs(
    raw ?? process.env.CHECKOUT_PREVIEW_CACHE_TTL_MS,
    30_000,
  );
}

/** Invalide les previews pricing checkout d’un utilisateur. */
export async function bustCartPricingCachesForUser(
  cache: Cache,
  userId: string,
): Promise<number> {
  const uid = String(userId ?? '').trim();
  if (!uid) return 0;
  return bustCacheKeysByPrefix(cache, `cart-pricing:v1:${uid}:`);
}

export function cacheUserScope(user?: UserModel): string {
  const id =
    (
      user as unknown as { _id?: { toString?: () => string } }
    )?._id?.toString?.() ?? '';
  return id || 'anon';
}

export function stableCacheHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
}

const inflight = new Map<string, Promise<unknown>>();

/** Lecture cache Redis/mémoire + déduplication requêtes parallèles (cache froid). */
export async function getOrSetCache<T>(
  cache: Cache,
  key: string,
  ttlMs: number,
  factory: () => Promise<T>,
): Promise<T> {
  const cached = await cache.get<T>(key);
  if (cached !== undefined && cached !== null) {
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }
  const task = (async () => {
    try {
      const res = await factory();
      await cache.set(key, res, ttlMs);
      return res;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

export async function bustCacheKey(
  cache: Cache,
  key: string,
): Promise<void> {
  await cache.del(key);
}

/** Invalide toutes les régions `product-detail:v2:*:{productId}`. */
export async function bustProductDetailCachesForProduct(
  cache: Cache,
  productId: string,
): Promise<void> {
  const pid = String(productId ?? '').trim();
  if (!pid) return;

  const store = (cache as { store?: unknown }).store;
  const client = (
    store as {
      client?: {
        keys?: (pattern: string) => Promise<string[]>;
      };
    }
  ).client;

  if (typeof client?.keys === 'function') {
    const keys = await client.keys(`product-detail:v2:*:${pid}`);
    if (keys.length) {
      await Promise.all(keys.map((k) => cache.del(k)));
    }
    return;
  }

  await bustCacheKey(cache, AppCacheKeys.productDetail(pid));
}

/** Supprime les clés Redis commençant par `prefix` (no-op si store sans SCAN). */
export async function bustCacheKeysByPrefix(
  cache: Cache,
  prefix: string,
): Promise<number> {
  const store = (cache as { store?: unknown }).store;
  if (!store) return 0;

  const client = (
    store as {
      client?: {
        keys?: (pattern: string) => Promise<string[]>;
      };
    }
  ).client;

  if (typeof client?.keys === 'function') {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) {
      await Promise.all(keys.map((k) => cache.del(k)));
    }
    return keys.length;
  }

  return 0;
}

/**
 * Invalide les réponses catalogue / recherche publiques (menu du jour, listing).
 * Appelé après mise à jour du menu du jour ou changement impactant le catalogue client.
 */
export async function bustCatalogListingPublicCaches(
  cache: Cache,
  storeId?: string,
): Promise<void> {
  const prefixes = [
    'search-filter:v1:',
    'home-feed:v3:',
    'shophome:v3-region:',
  ];
  if (storeId?.trim()) {
    const sid = storeId.trim();
    prefixes.push(`store-menu-page:v1:${sid}:`);
    prefixes.push(`store-menu-bundle:v1:${sid}:`);
    await bustCacheKey(cache, AppCacheKeys.storeMeta(sid));
  }
  await Promise.all(prefixes.map((p) => bustCacheKeysByPrefix(cache, p)));
}

const PUBLIC_CATALOG_CACHE_PREFIXES = [
  'search-filter:v1:',
  'home-feed:v3:',
  'shophome:v3-region:',
  'store-menu-page:v1:',
  'store-menu-bundle:v1:',
  'store-meta:v1:',
  'product-detail:v2:',
  'ads:public:v3-region:',
] as const;

const EXTENDED_PUBLIC_CACHE_PREFIXES = [
  ...PUBLIC_CATALOG_CACHE_PREFIXES,
  'product-categories:public:',
  'favlist:',
  'favlistgql:',
] as const;

/** Vide les caches catalogue client (menus, recherche, prix, accueil). */
export async function bustPublicCatalogAppCaches(
  cache: Cache,
): Promise<{ keysCleared: number }> {
  let keysCleared = 0;
  keysCleared += await bustCacheKeysByPrefix(
    cache,
    AppCacheKeys.announcements,
  );
  for (const prefix of PUBLIC_CATALOG_CACHE_PREFIXES) {
    keysCleared += await bustCacheKeysByPrefix(cache, prefix);
  }
  return { keysCleared };
}

/** Vide catalogue public + catégories + favoris. */
export async function bustAllPublicAppCaches(
  cache: Cache,
): Promise<{ keysCleared: number }> {
  let keysCleared = 0;
  keysCleared += await bustCacheKeysByPrefix(
    cache,
    AppCacheKeys.announcements,
  );
  for (const prefix of EXTENDED_PUBLIC_CACHE_PREFIXES) {
    keysCleared += await bustCacheKeysByPrefix(cache, prefix);
  }
  return { keysCleared };
}

export function detectCacheStoreKind(cache: Cache): 'redis' | 'memory' {
  const store = (cache as { store?: unknown }).store;
  const client = (
    store as {
      client?: { keys?: (pattern: string) => Promise<string[]> };
    }
  ).client;
  return typeof client?.keys === 'function' ? 'redis' : 'memory';
}

export const AppCacheKeys = {
  announcements: 'announcements:active:v1',
  adsPublic: (clientRegion: string) => {
    const code = String(clientRegion ?? '')
      .trim()
      .toUpperCase();
    return `ads:public:v3-region:${/^[A-Z]{2}$/.test(code) ? code : 'CA'}`;
  },
  homeFeed: (scope: string, limit: number, clientRegion: string) => {
    const code = String(clientRegion ?? '')
      .trim()
      .toUpperCase();
    return `home-feed:v3:${/^[A-Z]{2}$/.test(code) ? code : 'CA'}:${scope}:t${limit}`;
  },
  storeMeta: (storeId: string) => `store-meta:v1:${storeId}`,
  storeMenuBundle: (
    storeId: string,
    page: number,
    take: number,
    scope: string,
  ) => `store-menu-bundle:v1:${storeId}:p${page}:t${take}:${scope}`,
  storeMenuPage: (
    storeId: string,
    page: number,
    take: number,
    scope: string,
  ) => `store-menu-page:v1:${storeId}:p${page}:t${take}:${scope}`,
  productDetail: (productId: string, clientRegion?: string) => {
    const code = String(clientRegion ?? '')
      .trim()
      .toUpperCase();
    const region = /^[A-Z]{2}$/.test(code) ? code : 'CA';
    return `product-detail:v2:${region}:${productId}`;
  },
  searchFilter: (hash: string) => `search-filter:v1:${hash}`,
  cartPricing: (userId: string, inputHash: string) =>
    `cart-pricing:v1:${userId}:${inputHash}`,
} as const;
