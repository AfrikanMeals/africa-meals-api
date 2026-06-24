import Memcached from 'memcached';
import type { Store } from 'cache-manager';
import type { MemcachedConnectionConfig } from './memcached-connection.util';
import {
  tlsMemcachedDel,
  tlsMemcachedGet,
  tlsMemcachedSet,
} from './memcached-tls-client';

type MemcachedStoreOptions = {
  connection: MemcachedConnectionConfig;
  ttlMs?: number;
};

function defaultTtlSec(options: MemcachedStoreOptions, ttl?: number): number {
  return Math.max(1, Math.ceil((ttl ?? options.ttlMs ?? 60_000) / 1000));
}

function parseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

/** Store cache-manager — Memcached plain ou TLS (Stunnel sur cache.wise-eat.com). */
export function createMemcachedStore(
  options: MemcachedStoreOptions,
): Store {
  const tls = options.connection.tls;
  if (tls) {
    return createTlsMemcachedStore(options, tls);
  }

  const client = new Memcached(options.connection.servers, {
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
          resolve(parseJson<T>(data));
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

  return buildStore(getOne, setOne, (key) =>
    new Promise((resolve, reject) => {
      client.del(key, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  );
}

function createTlsMemcachedStore(
  options: MemcachedStoreOptions,
  tls: NonNullable<MemcachedConnectionConfig['tls']>,
): Store {
  const getOne = async <T>(key: string): Promise<T | undefined> => {
    const raw = await tlsMemcachedGet(tls, key);
    if (raw === undefined) return undefined;
    return parseJson<T>(raw);
  };

  const setOne = async (
    key: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> => {
    const ttlSec = defaultTtlSec(options, ttl);
    const payload =
      typeof value === 'string' ? value : JSON.stringify(value ?? null);
    await tlsMemcachedSet(tls, key, payload, ttlSec);
  };

  return buildStore(
    getOne,
    setOne,
    async (key) => {
      await tlsMemcachedDel(tls, key);
    },
  );
}

function buildStore(
  getOne: <T>(key: string) => Promise<T | undefined>,
  setOne: (key: string, value: unknown, ttl?: number) => Promise<void>,
  delOne: (key: string) => Promise<void>,
): Store {
  return {
    get: getOne,
    async set(key, value, ttl) {
      await setOne(key, value, ttl);
    },
    del(key) {
      return delOne(key);
    },
    async reset() {
      /* flush non supporté via TLS helper — no-op */
    },
    async mset(entries, ttl) {
      await Promise.all(entries.map(([key, value]) => setOne(key, value, ttl)));
    },
    async mget(...keys) {
      return Promise.all(keys.map((key) => getOne(key)));
    },
    async mdel(...keys) {
      await Promise.all(keys.map((key) => delOne(key)));
    },
    async keys() {
      return [];
    },
    async ttl(key) {
      const value = await getOne(key);
      return value === undefined ? 0 : 60_000;
    },
  };
}
