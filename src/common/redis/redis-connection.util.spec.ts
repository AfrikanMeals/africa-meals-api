import {
  buildIoredisOptionsFromConnection,
  isRedisReadonlyError,
  listBullmqRedisWriteConnectionsFromGetter,
  listRedisCacheConnectionsFromGetter,
  listRedisCacheWriteConnectionsFromGetter,
  redisConnectionEquals,
  redisConnectionKey,
} from './redis-connection.util';

describe('redis-connection.util write vs read lists', () => {
  const env = {
    REDIS_URL: 'rediss://cache-user:pass@cache.wise-eat.com:6381',
    REDIS_REPLICA_1_URL: 'rediss://cache-user:pass@cache.wise-eat.com:6383',
    REDIS_REPLICA_2_URL: 'rediss://cache-user:pass@cache.wise-eat.com:6384',
    BULLMQ_REDIS_URL: 'rediss://bull-user:pass@cache.wise-eat.com:6382',
    BULLMQ_REDIS_REPLICA_1_URL: 'rediss://bull-user:pass@cache.wise-eat.com:6385',
    BULLMQ_REDIS_REPLICA_2_URL: 'rediss://bull-user:pass@cache.wise-eat.com:6386',
  };

  const get = (key: string) => env[key as keyof typeof env];

  it('listRedisCacheWriteConnections ne retourne que le primary', () => {
    const write = listRedisCacheWriteConnectionsFromGetter(get);
    const read = listRedisCacheConnectionsFromGetter(get);
    expect(write).toHaveLength(1);
    expect(write[0]?.port).toBe(6381);
    expect(read).toHaveLength(3);
    expect(read.map((c) => c.port)).toEqual([6381, 6383, 6384]);
  });

  it('listBullmqRedisWriteConnections ne retourne que le primary BullMQ', () => {
    const write = listBullmqRedisWriteConnectionsFromGetter(get);
    expect(write).toHaveLength(1);
    expect(write[0]?.port).toBe(6382);
  });

  it('redisConnectionEquals compare host:port', () => {
    const a = { host: 'cache.wise-eat.com', port: 6381 };
    const b = { host: 'cache.wise-eat.com', port: 6381, tls: {} };
    const c = { host: 'cache.wise-eat.com', port: 6383 };
    expect(redisConnectionEquals(a, b)).toBe(true);
    expect(redisConnectionEquals(a, c)).toBe(false);
    expect(redisConnectionKey(a)).toBe('cache.wise-eat.com:6381');
  });

  it('isRedisReadonlyError détecte READONLY', () => {
    expect(
      isRedisReadonlyError(
        new Error("READONLY You can't write against a read only replica."),
      ),
    ).toBe(true);
    expect(isRedisReadonlyError(new Error('ECONNRESET'))).toBe(false);
  });

  it('buildIoredisOptionsFromConnection active keepAlive TLS par défaut', () => {
    const opts = buildIoredisOptionsFromConnection(
      { host: 'host.k3s.internal', port: 6381, tls: {} },
    );
    expect(opts.keepAlive).toBe(30_000);
    expect(opts.reconnectOnError).toBeDefined();
  });

  it('readRedisCacheStoreOptionsFromConfig expose username/password hors URL', () => {
    const { readRedisCacheStoreOptionsFromConfig } = require('./redis-connection.util');
    const config = {
      get: (key: string) =>
        ({
          REDIS_URL: 'rediss://wise-eat-cache:secret@cache.wise-eat.com:6381',
          REDIS_TLS_SERVERNAME: 'cache.wise-eat.com',
          REDIS_IP_FAMILY: '6',
        })[key],
    };
    const opts = readRedisCacheStoreOptionsFromConfig(config as never);
    expect(opts?.username).toBe('wise-eat-cache');
    expect(opts?.password).toBe('secret');
    expect(opts?.socket.host).toBe('cache.wise-eat.com');
    expect(opts?.socket.port).toBe(6381);
    expect(opts?.socket.tls).toBe(true);
    expect(opts?.socket.family).toBe(6);
    expect(opts?.url).toBeUndefined();
  });
});
