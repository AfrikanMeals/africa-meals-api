import { MapEngineCacheService } from './map-engine-cache.service';
import type { ConfigService } from '@nestjs/config';
import type { SharedRedisService } from '@common/redis/shared-redis.service';
import type { MapEngineHistoryService } from './map-engine-history.service';

describe('MapEngineCacheService', () => {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
  };
  const sharedRedis = {
    isConfigured: () => true,
    ensureConnected: async () => true,
    getClient: () => redis,
  } as unknown as SharedRedisService;
  const config = {
    get: () => undefined,
  } as unknown as ConfigService;
  const history = {
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordExternalOk: jest.fn(),
    recordExternalError: jest.fn(),
  } as unknown as MapEngineHistoryService;

  let svc: MapEngineCacheService;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    svc = new MapEngineCacheService(config, sharedRedis, history);
  });

  it('getOrSetJson stocke et rejoue un hit', async () => {
    let calls = 0;
    const a = await svc.getOrSetJson(
      'map:matrix:v1:test',
      60,
      async () => {
        calls += 1;
        return { engine: 'osrm', durations: [[0, 1]] };
      },
      { engine: 'osrm', kind: 'matrix' },
    );
    const b = await svc.getOrSetJson(
      'map:matrix:v1:test',
      60,
      async () => {
        calls += 1;
        return { engine: 'osrm', durations: [[0, 9]] };
      },
      { engine: 'osrm', kind: 'matrix' },
    );
    expect(a).toEqual(b);
    expect(calls).toBe(1);
    expect(history.recordCacheHit).toHaveBeenCalled();
  });

  it('fail-open factory null', async () => {
    await expect(
      svc.getOrSetJson('map:x', 30, async () => null),
    ).resolves.toBeNull();
  });
});
