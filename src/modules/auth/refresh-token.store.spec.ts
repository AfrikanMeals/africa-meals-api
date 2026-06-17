import { RefreshTokenStore } from './refresh-token.store';

describe('RefreshTokenStore (H-03)', () => {
  const redis = {
    isEnabled: () => false,
    getClient: () => null,
  };

  it('registers and consumes a jti once', async () => {
    const store = new RefreshTokenStore(redis as never);
    await store.register('jti-1', 'user-a', 60);
    await expect(store.consume('jti-1', 'user-a')).resolves.toBe(true);
    await expect(store.consume('jti-1', 'user-a')).resolves.toBe(false);
  });

  it('rejects wrong userId', async () => {
    const store = new RefreshTokenStore(redis as never);
    await store.register('jti-2', 'user-a', 60);
    await expect(store.consume('jti-2', 'user-b')).resolves.toBe(false);
  });
});
