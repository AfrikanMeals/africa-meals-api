import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { InfraRuntimeSettingsModel } from '@schemas/infra-runtime-settings.schema';
import { DomainEventIdempotencyStore } from './domain-event-idempotency.store';
import { DomainEventRegistryService } from './domain-event-registry.service';
import { DomainEventPublisherService } from './domain-event-publisher.service';

describe('DomainEventPublisherService', () => {
  const validDraft = {
    type: 'order.delivered' as const,
    payload: { orderId: '507f1f77bcf86cd799439011' },
  };

  function createPublisher(env: Record<string, string | undefined>) {
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    const registry = new DomainEventRegistryService();
    const idempotency = new DomainEventIdempotencyStore(config);
    idempotency.onModuleInit();
    const infraModel = {
      findOne: () => ({
        lean: () => ({
          exec: async () => ({
            redisManagerEnabled: true,
            mqBrokerEnabled: false,
          }),
        }),
      }),
    } as unknown as Model<InfraRuntimeSettingsModel>;
    const publisher = new DomainEventPublisherService(
      config,
      registry,
      idempotency,
      infraModel,
    );
    return { publisher, idempotency };
  }

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it('skips publish when DOMAIN_EVENTS_ENABLED is false', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'false',
    });

    const result = await publisher.publish(validDraft);

    expect(result.ok).toBe(false);
    expect(result.mode).toBe('skipped');
    expect(result.reason).toBe('domain_events_disabled');
  });

  it('skips publish when no broker is available', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
    });

    const result = await publisher.publish(validDraft);

    expect(result.ok).toBe(false);
    expect(result.mode).toBe('skipped');
    expect(result.reason).toBe('no_broker_available');
  });

  it('returns duplicate when the same event id is published twice', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
    });

    const envelope = new DomainEventRegistryService().buildForPublish({
      ...validDraft,
      id: '22222222-2222-4222-8222-222222222222',
    });

    jest
      .spyOn(
        publisher as unknown as {
          readInfraSettings: () => Promise<unknown>;
        },
        'readInfraSettings',
      )
      .mockResolvedValue({
        redisManagerEnabled: false,
        mqBrokerEnabled: true,
      });

    Object.defineProperty(publisher, 'mqttClient', { value: {} });
    Object.defineProperty(publisher, 'mqttConnected', { value: true });
    jest
      .spyOn(
        publisher as unknown as {
          publishEnvelopeToMqtt: () => Promise<void>;
        },
        'publishEnvelopeToMqtt',
      )
      .mockResolvedValue(undefined);

    const first = await publisher.publishEnvelope(envelope);
    const second = await publisher.publishEnvelope(envelope);

    expect(first.mode).toBe('mqtt');
    expect(first.ok).toBe(true);
    expect(second.mode).toBe('duplicate');
    expect(second.ok).toBe(true);
  });
});
