import { buildSystemExchangeResponse } from './system-exchange.builder';

describe('system-exchange.builder', () => {
  it('construit plateformes et liens', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, string> = {
          NODE_ENV: 'test',
          SERVER_URL: 'http://localhost:9000',
          AFRICA_MEALS_WS_INTERNAL_URL: 'http://localhost:8000',
          REDIS_URL: '',
        };
        return map[key];
      },
    };

    const result = await buildSystemExchangeResponse({
      config: config as never,
      connection: {
        db: {
          admin: () => ({
            ping: async () => ({ ok: 1 }),
          }),
        },
      } as never,
      mqtt: {
        apiPublisher: {
          enabled: true,
          state: 'connected',
          lastError: null,
          lastTopicSeen: 'order/update',
          lastMessageAt: new Date().toISOString(),
        },
        wsSubscriber: {
          enabled: true,
          state: 'connected',
          lastError: null,
          lastTopicSeen: 'order/update',
          lastMessageAt: new Date().toISOString(),
        },
      },
      runtime: { redisManagerEnabled: true, mqBrokerEnabled: true },
      firebaseMessagingOk: true,
    });

    expect(result.platforms.length).toBeGreaterThan(5);
    expect(result.links.some((l) => l.id === 'api-mqtt')).toBe(true);
    expect(result.summary.healthy).toBeGreaterThan(0);
  });
});
