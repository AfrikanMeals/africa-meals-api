import { RecommendationFacade } from './recommendation-facade.service';
import type { Neo4jService } from '@modules/neo4j/neo4j.service';
import type { GraphRecommendationService } from './graph-recommendation.service';
import { setGraphRuntimeFlagOverrides } from '@modules/graphdb-settings/graph-config.util';

describe('RecommendationFacade', () => {
  afterEach(() => {
    setGraphRuntimeFlagOverrides(null);
    jest.useRealTimers();
  });

  it('returns null when graph reco flags off (fail-open Mongo)', async () => {
    const facade = new RecommendationFacade(
      { isHealthy: () => true } as Neo4jService,
      {
        personalizedStoreIds: jest.fn(),
      } as unknown as GraphRecommendationService,
    );
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1', region: 'CM' }),
    ).resolves.toBeNull();
  });

  it('returns null when Neo4j unhealthy', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const facade = new RecommendationFacade(
      { isHealthy: () => false } as Neo4jService,
      {
        personalizedStoreIds: jest.fn().mockResolvedValue(['s1']),
      } as unknown as GraphRecommendationService,
    );
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1' }),
    ).resolves.toBeNull();
  });

  it('returns ids on success', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const personalizedStoreIds = jest.fn().mockResolvedValue(['s1', 's2']);
    const facade = new RecommendationFacade(
      { isHealthy: () => true } as Neo4jService,
      { personalizedStoreIds } as unknown as GraphRecommendationService,
    );
    await expect(
      facade.personalizedStoreIdsOrNull({
        userId: 'u1',
        region: 'CA',
        limit: 8,
      }),
    ).resolves.toEqual(['s1', 's2']);
    expect(personalizedStoreIds).toHaveBeenCalledWith('u1', 'CA', 8);
  });

  it('fails open on timeout', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    process.env.RECO_GRAPH_TIMEOUT_MS = '50';
    const personalizedStoreIds = jest.fn(
      () =>
        new Promise<string[]>((resolve) => {
          setTimeout(() => resolve(['s1']), 500);
        }),
    );
    const facade = new RecommendationFacade(
      { isHealthy: () => true } as Neo4jService,
      { personalizedStoreIds } as unknown as GraphRecommendationService,
    );
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1' }),
    ).resolves.toBeNull();
    delete process.env.RECO_GRAPH_TIMEOUT_MS;
  });
});
