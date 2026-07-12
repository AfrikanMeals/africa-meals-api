import { RecommendationFacade } from './recommendation-facade.service';
import type { Neo4jService } from '@modules/neo4j/neo4j.service';
import type { GraphRecommendationService } from './graph-recommendation.service';
import { setGraphRuntimeFlagOverrides } from '@modules/graphdb-settings/graph-config.util';

describe('RecommendationFacade', () => {
  afterEach(() => {
    setGraphRuntimeFlagOverrides(null);
    jest.useRealTimers();
  });

  function makeFacade(opts: {
    ensureHealthy: jest.Mock;
    personalizedStoreIds?: jest.Mock;
  }) {
    return new RecommendationFacade(
      { ensureHealthy: opts.ensureHealthy } as unknown as Neo4jService,
      {
        personalizedStoreIds:
          opts.personalizedStoreIds ?? jest.fn().mockResolvedValue(['s1']),
      } as unknown as GraphRecommendationService,
    );
  }

  it('returns null when graph reco flags off (fail-open Mongo)', async () => {
    const ensureHealthy = jest.fn().mockResolvedValue(true);
    const facade = makeFacade({ ensureHealthy });
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1', region: 'CM' }),
    ).resolves.toBeNull();
    expect(ensureHealthy).not.toHaveBeenCalled();
  });

  it('returns null when Neo4j unhealthy after ensureHealthy', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const facade = makeFacade({
      ensureHealthy: jest.fn().mockResolvedValue(false),
    });
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1' }),
    ).resolves.toBeNull();
  });

  it('opens driver via ensureHealthy when Admin reco flags ON', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const personalizedStoreIds = jest.fn().mockResolvedValue(['s1', 's2']);
    const ensureHealthy = jest.fn().mockResolvedValue(true);
    const facade = makeFacade({ ensureHealthy, personalizedStoreIds });
    await expect(
      facade.personalizedStoreIdsOrNull({
        userId: 'u1',
        region: 'CA',
        limit: 8,
      }),
    ).resolves.toEqual(['s1', 's2']);
    expect(ensureHealthy).toHaveBeenCalled();
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
    const facade = makeFacade({
      ensureHealthy: jest.fn().mockResolvedValue(true),
      personalizedStoreIds,
    });
    await expect(
      facade.personalizedStoreIdsOrNull({ userId: 'u1' }),
    ).resolves.toBeNull();
    delete process.env.RECO_GRAPH_TIMEOUT_MS;
  });
});
