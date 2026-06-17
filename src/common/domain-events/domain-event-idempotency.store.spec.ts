import { ConfigService } from '@nestjs/config';
import { DomainEventIdempotencyStore } from './domain-event-idempotency.store';

describe('DomainEventIdempotencyStore', () => {
  function createStore(): DomainEventIdempotencyStore {
    const config = {
      get: (key: string) => {
        if (key === 'DOMAIN_EVENTS_IDEMPOTENCY_TTL_SEC') return '60';
        return undefined;
      },
    } as unknown as ConfigService;
    return new DomainEventIdempotencyStore(config);
  }

  it('claims a new event id once (in-memory fallback)', async () => {
    const store = createStore();
    store.onModuleInit();

    await expect(store.tryClaim('11111111-1111-4111-8111-111111111111')).resolves.toBe(
      true,
    );
    await expect(store.tryClaim('11111111-1111-4111-8111-111111111111')).resolves.toBe(
      false,
    );

    await store.onModuleDestroy();
  });
});
