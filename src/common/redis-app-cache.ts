import { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { UserModel } from '@schemas/user.schema';

export function parseCacheTtlMs(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** TTL par défaut des réponses publiques catalogue / recherche (ms). */
export function apiPublicCacheTtlMs(raw?: string): number {
  return parseCacheTtlMs(raw ?? process.env.API_PUBLIC_CACHE_TTL_MS, 90_000);
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
} as const;
