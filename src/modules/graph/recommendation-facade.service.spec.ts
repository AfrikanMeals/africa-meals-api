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
    personalizedProductIds?: jest.Mock;
    storeIdsDeliveringToZone?: jest.Mock;
    frequentlyBoughtWith?: jest.Mock;
    similarProductIds?: jest.Mock;
    buyAgainCandidates?: jest.Mock;
  }) {
    return new RecommendationFacade(
      { ensureHealthy: opts.ensureHealthy } as unknown as Neo4jService,
      {
        personalizedStoreIds:
          opts.personalizedStoreIds ?? jest.fn().mockResolvedValue(['s1']),
        personalizedProductIds:
          opts.personalizedProductIds ??
          jest.fn().mockResolvedValue(['p1', 'p2']),
        storeIdsDeliveringToZone:
          opts.storeIdsDeliveringToZone ?? jest.fn().mockResolvedValue(['z1']),
        frequentlyBoughtWith:
          opts.frequentlyBoughtWith ??
          jest.fn().mockResolvedValue([{ productId: 'f1', score: 2 }]),
        similarProductIds:
          opts.similarProductIds ??
          jest.fn().mockResolvedValue([{ productId: 's1', score: 1 }]),
        buyAgainCandidates:
          opts.buyAgainCandidates ??
          jest.fn().mockResolvedValue([
            {
              productId: 'ba1',
              orderCount: 2,
              lastAt: '2026-07-01T00:00:00.000Z',
              totalSpent: 20,
            },
          ]),
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

  it('personalizedProductIdsOrNull retourne les IDs graphe', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const personalizedProductIds = jest.fn().mockResolvedValue(['p9']);
    const facade = makeFacade({
      ensureHealthy: jest.fn().mockResolvedValue(true),
      personalizedProductIds,
    });
    await expect(
      facade.personalizedProductIdsOrNull({ userId: 'u1', limit: 10 }),
    ).resolves.toEqual(['p9']);
    expect(personalizedProductIds).toHaveBeenCalledWith('u1', 10);
  });

  it('storeIdsDeliveringToZoneOrNull et relatedProductIdsOrNull', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const facade = makeFacade({
      ensureHealthy: jest.fn().mockResolvedValue(true),
    });
    await expect(
      facade.storeIdsDeliveringToZoneOrNull({ zoneId: 'zone-a', limit: 5 }),
    ).resolves.toEqual(['z1']);
    await expect(
      facade.relatedProductIdsOrNull({ productId: 'p0', limit: 8 }),
    ).resolves.toEqual(['f1', 's1']);
  });

  it('buyAgainCandidatesOrNull retourne les stats ORDERED', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const buyAgainCandidates = jest.fn().mockResolvedValue([
      {
        productId: 'p-ba',
        orderCount: 3,
        lastAt: '2026-07-20T00:00:00.000Z',
        totalSpent: 45,
      },
    ]);
    const facade = makeFacade({
      ensureHealthy: jest.fn().mockResolvedValue(true),
      buyAgainCandidates,
    });
    await expect(
      facade.buyAgainCandidatesOrNull({
        userId: 'u1',
        region: 'CM',
        limit: 24,
      }),
    ).resolves.toEqual([
      {
        productId: 'p-ba',
        orderCount: 3,
        lastAt: '2026-07-20T00:00:00.000Z',
        totalSpent: 45,
      },
    ]);
    expect(buyAgainCandidates).toHaveBeenCalledWith('u1', 'CM', 24);
  });
});
