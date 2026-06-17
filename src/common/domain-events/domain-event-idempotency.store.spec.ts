import { ConfigService } from '@nestjs/config';
import { DomainEventIdempotencyStore } from './domain-event-idempotency.store';
import { SharedRedisService } from '../redis/shared-redis.service';

describe('DomainEventIdempotencyStore', () => {
  function createStore(): DomainEventIdempotencyStore {
    const config = {
      get: (key: string) => {
        if (key === 'DOMAIN_EVENTS_IDEMPOTENCY_TTL_SEC') return '60';
        return undefined;
      },
    } as unknown as ConfigService;
    const sharedRedis = {
      getClient: () => null,
    } as unknown as SharedRedisService;
    return new DomainEventIdempotencyStore(config, sharedRedis);
  }

  it('claims a new event id once (in-memory fallback)', async () => {
    const store = createStore();

    await expect(store.tryClaim('11111111-1111-4111-8111-111111111111')).resolves.toBe(
      true,
    );
    await expect(store.tryClaim('11111111-1111-4111-8111-111111111111')).resolves.toBe(
      false,
    );
  });
});
