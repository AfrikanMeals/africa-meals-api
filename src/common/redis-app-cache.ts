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
  return bustCacheKeysByPrefix(cache, `cart-pricing:v1:${uid}:`, {
    skipClusterNotify: true,
  });
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

export const APP_CACHE_BUST_CHANNEL = 'wise-eat:app-cache-bust';
const BUST_GEN_REDIS_KEY = 'wise-eat:app-cache:bust-generation';

let localBustGeneration = 0;
let redisBustClient: {
  get: (key: string) => Promise<string | null>;
  incr: (key: string) => Promise<number>;
} | null = null;

let clusterBustPublisher: ((payload: string) => Promise<void>) | null = null;

/** Client Redis partagé (compteur bust cluster + pub/sub). */
export function registerAppCacheBustRedis(
  client: {
    get: (key: string) => Promise<string | null>;
    incr: (key: string) => Promise<number>;
  } | null | undefined,
): void {
  redisBustClient = client ?? null;
}

export function registerAppCacheBustClusterPublisher(
  fn: (payload: string) => Promise<void>,
): void {
  clusterBustPublisher = fn;
}

export function bumpCacheBustGenerationLocal(): void {
  localBustGeneration++;
}

export function clearInflightCache(): void {
  inflight.clear();
}

export async function readCacheBustGeneration(): Promise<number> {
  if (redisBustClient) {
    try {
      const raw = await redisBustClient.get(BUST_GEN_REDIS_KEY);
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    } catch {
      /* best-effort */
    }
  }
  return localBustGeneration;
}

/** Invalide les écritures cache en cours (requêtes parallèles après bust admin / catalogue). */
export async function bumpCacheBustGeneration(): Promise<void> {
  bumpCacheBustGenerationLocal();
  clearInflightCache();
  if (redisBustClient) {
    try {
      await redisBustClient.incr(BUST_GEN_REDIS_KEY);
    } catch {
      /* best-effort */
    }
  }
}

export async function notifyClusterCacheBust(
  prefixes: string[],
): Promise<void> {
  const unique = [...new Set(prefixes.map((p) => String(p).trim()).filter(Boolean))];
  if (!unique.length || !clusterBustPublisher) return;
  try {
    await clusterBustPublisher(
      JSON.stringify({ prefixes: unique, at: Date.now() }),
    );
  } catch {
    /* best-effort */
  }
}

/** Annule les requêtes en cours dont la clé correspond (évite ré-écriture stale après bust). */
export function bustInflightCacheKeysMatching(
  matcher: (key: string) => boolean,
): number {
  let cleared = 0;
  for (const key of [...inflight.keys()]) {
    if (matcher(key)) {
      inflight.delete(key);
      cleared++;
    }
  }
  return cleared;
}

function bustInflightByPrefix(prefix: string): number {
  return bustInflightCacheKeysMatching((key) => key.startsWith(prefix));
}

function collectMemoryStoreKeys(
  cache: Cache,
  prefix: string,
): string[] {
  const out = new Set<string>();
  const visited = new Set<object>();

  const walk = (node: unknown, depth = 0): void => {
    if (node == null || depth > 5 || typeof node !== 'object') return;
    if (visited.has(node as object)) return;
    visited.add(node as object);

    if (node instanceof Map) {
      for (const k of node.keys()) {
        const sk = String(k);
        if (sk.startsWith(prefix)) out.add(sk);
      }
      return;
    }

    const rec = node as Record<string, unknown>;
    for (const prop of ['store', 'data', 'cache', 'map'] as const) {
      if (prop in rec) walk(rec[prop], depth + 1);
    }
  };

  walk((cache as { store?: unknown }).store);
  return [...out];
}

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
  const genAtStart = await readCacheBustGeneration();
  const task = (async () => {
    try {
      const res = await factory();
      const genAtEnd = await readCacheBustGeneration();
      if (genAtStart === genAtEnd) {
        await cache.set(key, res, ttlMs);
      }
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
  inflight.delete(key);
  await cache.del(key);
}

/** Invalide toutes les régions `product-detail:v2:*:{productId}`. */
export async function bustProductDetailCachesForProduct(
  cache: Cache,
  productId: string,
): Promise<void> {
  const pid = String(productId ?? '').trim();
  if (!pid) return;

  bustInflightCacheKeysMatching((key) => key.includes(`:${pid}`));

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

type BustCacheKeysOptions = {
  skipClusterNotify?: boolean;
};

/** Supprime les clés Redis / mémoire commençant par `prefix`. */
export async function bustCacheKeysByPrefix(
  cache: Cache,
  prefix: string,
  options?: BustCacheKeysOptions,
): Promise<number> {
  bustInflightByPrefix(prefix);

  const store = (cache as { store?: unknown }).store;
  if (!store) return 0;

  const client = (
    store as {
      client?: {
        keys?: (pattern: string) => Promise<string[]>;
        scanIterator?: (opts: { MATCH: string }) => AsyncIterable<string>;
      };
    }
  ).client;

  let keys: string[] = [];

  if (typeof client?.scanIterator === 'function') {
    for await (const key of client.scanIterator({ MATCH: `${prefix}*` })) {
      keys.push(String(key));
    }
  } else if (typeof client?.keys === 'function') {
    keys = await client.keys(`${prefix}*`);
  } else {
    const storeKeysFn = (
      store as { keys?: () => Promise<string[]> }
    ).keys;
    if (typeof storeKeysFn === 'function') {
      const all = await storeKeysFn.call(store);
      keys = all.filter((k) => String(k).startsWith(prefix));
    } else {
      keys = collectMemoryStoreKeys(cache, prefix);
    }
  }

  if (keys.length) {
    await Promise.all(keys.map((k) => cache.del(k)));
  }
  if (!options?.skipClusterNotify) {
    void notifyClusterCacheBust([prefix]);
  }
  return keys.length;
}

/**
 * Invalide les réponses catalogue / recherche publiques (menu du jour, listing).
 * Appelé après mise à jour du menu du jour ou changement impactant le catalogue client.
 */
export async function bustCatalogListingPublicCaches(
  cache: Cache,
  storeId?: string,
): Promise<void> {
  await bumpCacheBustGeneration();
  const prefixes = [
    'search-filter:v1:',
    'home-feed:v3:',
    'shophome:v3-region:',
  ];
  if (storeId?.trim()) {
    const sid = storeId.trim();
    prefixes.push(`store-menu-page:v1:${sid}:`);
    prefixes.push(`store-menu-bundle:v1:${sid}:`);
    bustInflightByPrefix(`store-meta:v1:${sid}`);
    await bustCacheKey(cache, AppCacheKeys.storeMeta(sid));
  }
  for (const p of prefixes) {
    bustInflightByPrefix(p);
  }
  await Promise.all(
    prefixes.map((p) =>
      bustCacheKeysByPrefix(cache, p, { skipClusterNotify: true }),
    ),
  );
  void notifyClusterCacheBust(prefixes);
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

const ENTIRE_APP_CACHE_PREFIXES = [
  ...EXTENDED_PUBLIC_CACHE_PREFIXES,
  'cart-pricing:v1:',
] as const;

async function bustPrefixesBatch(
  cache: Cache,
  prefixes: readonly string[],
  exactKeys: string[] = [],
): Promise<number> {
  await bumpCacheBustGeneration();
  let keysCleared = 0;
  for (const key of exactKeys) {
    bustInflightCacheKeysMatching((k) => k === key);
    await cache.del(key);
    keysCleared++;
  }
  for (const prefix of prefixes) {
    keysCleared += await bustCacheKeysByPrefix(cache, prefix, {
      skipClusterNotify: true,
    });
  }
  void notifyClusterCacheBust([...prefixes, ...exactKeys]);
  return keysCleared;
}

/** Vide les caches catalogue client (menus, recherche, prix, accueil). */
export async function bustPublicCatalogAppCaches(
  cache: Cache,
): Promise<{ keysCleared: number }> {
  const keysCleared = await bustPrefixesBatch(
    cache,
    PUBLIC_CATALOG_CACHE_PREFIXES,
    [AppCacheKeys.announcements],
  );
  return { keysCleared };
}

/** Vide catalogue public + catégories + favoris. */
export async function bustAllPublicAppCaches(
  cache: Cache,
): Promise<{ keysCleared: number }> {
  const keysCleared = await bustPrefixesBatch(
    cache,
    EXTENDED_PUBLIC_CACHE_PREFIXES,
    [AppCacheKeys.announcements],
  );
  return { keysCleared };
}

/** Vide tout le cache applicatif connu (catalogue, favoris, pricing panier). */
export async function bustEntireAppCaches(
  cache: Cache,
): Promise<{ keysCleared: number }> {
  if (detectCacheStoreKind(cache) === 'memory') {
    await bumpCacheBustGeneration();
    const resetFn = (cache as { reset?: () => Promise<void> }).reset;
    if (typeof resetFn === 'function') {
      await resetFn.call(cache);
      void notifyClusterCacheBust([...ENTIRE_APP_CACHE_PREFIXES]);
      return { keysCleared: -1 };
    }
  }
  const keysCleared = await bustPrefixesBatch(
    cache,
    ENTIRE_APP_CACHE_PREFIXES,
    [AppCacheKeys.announcements],
  );
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
