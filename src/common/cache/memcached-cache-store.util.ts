import Memcached from 'memcached';
import type { Store } from 'cache-manager';

type MemcachedStoreOptions = {
  servers: string;
  ttlMs?: number;
};

function defaultTtlSec(options: MemcachedStoreOptions, ttl?: number): number {
  return Math.max(1, Math.ceil((ttl ?? options.ttlMs ?? 60_000) / 1000));
}

/** Store cache-manager v5 compatible pour Memcached. */
export function createMemcachedStore(
  options: MemcachedStoreOptions,
): Store {
  const client = new Memcached(options.servers, {
    retries: 2,
    retry: 500,
    timeout: 2000,
  });

  const getOne = <T>(key: string): Promise<T | undefined> =>
    new Promise((resolve) => {
      client.get(key, (err, data) => {
        if (err || data === undefined || data === null) {
          resolve(undefined);
          return;
        }
        if (typeof data === 'string') {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
          return;
        }
        resolve(data as T);
      });
    });

  const setOne = (key: string, value: unknown, ttl?: number): Promise<void> => {
    const ttlSec = defaultTtlSec(options, ttl);
    const payload =
      typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return new Promise((resolve, reject) => {
      client.set(key, payload, ttlSec, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return {
    get: getOne,
    async set(key, value, ttl) {
      await setOne(key, value, ttl);
    },
    del(key) {
      return new Promise((resolve, reject) => {
        client.del(key, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    reset() {
      return new Promise((resolve, reject) => {
        client.flush((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    async mset(entries, ttl) {
      await Promise.all(entries.map(([key, value]) => setOne(key, value, ttl)));
    },
    async mget(...keys) {
      return Promise.all(keys.map((key) => getOne(key)));
    },
    async mdel(...keys) {
      await Promise.all(keys.map((key) => this.del(key)));
    },
    async keys() {
      return [];
    },
    async ttl(key) {
      const value = await getOne(key);
      return value === undefined ? 0 : defaultTtlSec(options) * 1000;
    },
  };
}
