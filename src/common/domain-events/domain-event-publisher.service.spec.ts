import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { InfraRuntimeSettingsModel } from '@schemas/infra-runtime-settings.schema';
import { SharedRedisService } from '../redis/shared-redis.service';
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
    const sharedRedis = {
      getClient: () => null,
    } as unknown as SharedRedisService;
    const idempotency = new DomainEventIdempotencyStore(config, sharedRedis);
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

  it('skips bus publish when no broker is available but marks handlers scheduled', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
    });

    const result = await publisher.publish(validDraft);

    expect(result.ok).toBe(true);
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

  it('does not await in-process handler when DOMAIN_EVENTS_HANDLERS_ASYNC is true', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
      DOMAIN_EVENTS_HANDLERS_ASYNC: 'true',
    });

    const envelope = new DomainEventRegistryService().buildForPublish({
      ...validDraft,
      id: '33333333-3333-4333-8333-333333333333',
    });

    let handlerStarted = false;
    let handlerFinished = false;
    publisher.registerInProcessHandler(async () => {
      handlerStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
      handlerFinished = true;
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

    const result = await publisher.publishEnvelope(envelope);

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('mqtt');
    expect(handlerStarted).toBe(true);
    expect(handlerFinished).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(handlerFinished).toBe(true);
  });

  it('awaits in-process handler when DOMAIN_EVENTS_HANDLERS_ASYNC is false', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
      DOMAIN_EVENTS_HANDLERS_ASYNC: 'false',
    });

    const envelope = new DomainEventRegistryService().buildForPublish({
      ...validDraft,
      id: '44444444-4444-4444-8444-444444444444',
    });

    let handlerFinished = false;
    publisher.registerInProcessHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      handlerFinished = true;
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

    const result = await publisher.publishEnvelope(envelope);

    expect(result.ok).toBe(true);
    expect(handlerFinished).toBe(true);
  });

  it('enqueues handler job when handlers queue is enabled', async () => {
    const { publisher } = createPublisher({
      DOMAIN_EVENTS_ENABLED: 'true',
      DOMAIN_EVENTS_HANDLERS_ASYNC: 'true',
    });

    const envelope = new DomainEventRegistryService().buildForPublish({
      ...validDraft,
      id: '55555555-5555-4555-8555-555555555555',
    });

    const handler = jest.fn().mockResolvedValue(undefined);
    publisher.registerInProcessHandler(handler);

    const enqueueHandler = jest.fn().mockResolvedValue(undefined);
    jest
      .spyOn(
        publisher as unknown as {
          readInfraSettings: () => Promise<unknown>;
        },
        'readInfraSettings',
      )
      .mockResolvedValue({
        redisManagerEnabled: true,
        mqBrokerEnabled: false,
      });
    jest
      .spyOn(
        publisher as unknown as {
          enqueueHandler: (e: unknown) => Promise<void>;
        },
        'enqueueHandler',
      )
      .mockImplementation(enqueueHandler);
    Object.defineProperty(publisher, 'handlersQueueEnabled', { value: true });
    Object.defineProperty(publisher, 'handlersQueue', { value: {} });
    Object.defineProperty(publisher, 'queueEnabled', { value: true });
    Object.defineProperty(publisher, 'queue', { value: { add: jest.fn() } });

    const result = await publisher.publishEnvelope(envelope);

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('queued');
    expect(enqueueHandler).toHaveBeenCalledWith(envelope);
    expect(handler).not.toHaveBeenCalled();
  });
});
