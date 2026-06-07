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

export const AppCacheKeys = {
  announcements: 'announcements:active:v1',
  adsPublic: 'ads:public:v2-stripe',
  homeFeed: (scope: string, limit: number) =>
    `home-feed:v2:${scope}:t${limit}`,
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
  productDetail: (productId: string) => `product-detail:v1:${productId}`,
  searchFilter: (hash: string) => `search-filter:v1:${hash}`,
} as const;
