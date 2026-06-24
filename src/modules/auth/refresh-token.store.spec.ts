import { RefreshTokenStore } from './refresh-token.store';

describe('RefreshTokenStore (H-03)', () => {
  const memoryRedis = {
    isConfigured: () => false,
    isEnabled: () => false,
    getClient: () => null,
  };

  it('registers and consumes a jti once', async () => {
    const store = new RefreshTokenStore(memoryRedis as never);
    await store.register('jti-1', 'user-a', 60);
    await expect(store.consume('jti-1', 'user-a')).resolves.toBe(true);
    await expect(store.consume('jti-1', 'user-a')).resolves.toBe(false);
  });

  it('rejects wrong userId', async () => {
    const store = new RefreshTokenStore(memoryRedis as never);
    await store.register('jti-2', 'user-a', 60);
    await expect(store.consume('jti-2', 'user-b')).resolves.toBe(false);
  });

  it('uses Redis when configured even before ready (cluster-safe)', async () => {
    const client = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(JSON.stringify({ userId: 'user-a' })),
      del: jest.fn().mockResolvedValue(1),
    };
    const redis = {
      isConfigured: () => true,
      isEnabled: () => false,
      getClient: () => client,
    };
    const store = new RefreshTokenStore(redis as never);
    await store.register('jti-3', 'user-a', 60);
    expect(client.set).toHaveBeenCalled();
    await expect(store.consume('jti-3', 'user-a')).resolves.toBe(true);
    expect(client.del).toHaveBeenCalled();
  });

  it('does not fall back to memory when Redis is configured but unavailable', async () => {
    const redis = {
      isConfigured: () => true,
      isEnabled: () => false,
      getClient: () => null,
    };
    const store = new RefreshTokenStore(redis as never);
    await store.register('jti-4', 'user-a', 60);
    await expect(store.consume('jti-4', 'user-a')).resolves.toBe(false);
  });
});
