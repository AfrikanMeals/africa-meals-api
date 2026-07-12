import { GraphSyncService } from './graph-sync.service';
import type { Neo4jService } from '@modules/neo4j/neo4j.service';

describe('GraphSyncService', () => {
  const runCypher = jest.fn().mockResolvedValue([]);
  const neo4j = { runCypher } as unknown as Neo4jService;
  let svc: GraphSyncService;

  beforeEach(() => {
    runCypher.mockClear().mockResolvedValue([]);
    svc = new GraphSyncService(neo4j);
  });

  it('applyOrderCompleted MERGEs user/store and line items', async () => {
    await svc.applyOrderCompleted({
      orderId: 'o1',
      userId: 'u1',
      storeId: 's1',
      region: 'CM',
      totalSpent: 12,
      completedAt: '2026-07-12T00:00:00.000Z',
      items: [
        { entityId: 'p1', itemType: 'product', quantity: 2, price: 5 },
        { entityId: 'd1', itemType: 'drink', quantity: 1, price: 2 },
      ],
    });

    expect(runCypher.mock.calls.length).toBeGreaterThanOrEqual(4);
    const queries = runCypher.mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => q.includes('ORDERED_FROM'))).toBe(true);
    expect(queries.some((q) => q.includes('Product'))).toBe(true);
    expect(queries.some((q) => q.includes('Drink'))).toBe(true);
  });

  it('applySignalTracked maps store_view to VIEWED', async () => {
    await svc.applySignalTracked({
      userId: 'u1',
      kind: 'store_view',
      refId: 's1',
      at: '2026-07-12T00:00:00.000Z',
    });
    const q = String(runCypher.mock.calls.at(-1)?.[0] ?? '');
    expect(q).toContain('VIEWED');
    expect(q).toContain('Store');
  });

  it('applyStoreSubscribed MERGEs SUBSCRIBED_TO', async () => {
    await svc.applyStoreSubscribed({
      userId: 'u1',
      storeId: 's1',
      at: '2026-07-12T00:00:00.000Z',
    });
    const q = String(runCypher.mock.calls.at(-1)?.[0] ?? '');
    expect(q).toContain('SUBSCRIBED_TO');
  });

  it('recomputeStoreSimilarity runs co-order + co-sub batches', async () => {
    runCypher
      .mockResolvedValueOnce([]) // constraints x4 roughly — ensureConstraints loops
      .mockResolvedValue([]);
    // Reset and stub ensureConstraints by calling recompute with fresh service
    // that already has constraintsReady via prior call
    await svc.ensureConstraints();
    runCypher.mockClear().mockResolvedValue([{ pairs: 3 }]);
    const out = await svc.recomputeStoreSimilarity({ minShared: 2 });
    expect(out.pairs).toBe(6);
    expect(runCypher).toHaveBeenCalledTimes(2);
    expect(String(runCypher.mock.calls[0][0])).toContain('SIMILAR_TO');
  });
});
