import { GraphMapIntelligenceService } from './graph-map-intelligence.service';
import type { Neo4jService } from '@modules/neo4j/neo4j.service';

jest.mock('@modules/graphdb-settings/graph-config.util', () => ({
  isNeo4jEnabled: jest.fn(() => true),
}));

describe('GraphMapIntelligenceService', () => {
  const runCypher = jest.fn();
  const neo4j = { runCypher } as unknown as Neo4jService;
  let svc: GraphMapIntelligenceService;

  beforeEach(() => {
    runCypher.mockReset();
    svc = new GraphMapIntelligenceService(neo4j);
  });

  it('courierIdsAvailableInRegion mappe agentUserId', async () => {
    runCypher.mockResolvedValue([{ agentUserId: 'a1' }, { agentUserId: 'a2' }]);
    const ids = await svc.courierIdsAvailableInRegion('CM');
    expect(ids).toEqual(['a1', 'a2']);
    expect(String(runCypher.mock.calls[0][0])).toContain('AVAILABLE_IN');
  });

  it('averageTrafficFactorNear clamp le facteur', async () => {
    runCypher.mockResolvedValue([{ factor: 3.5 }]);
    await expect(svc.averageTrafficFactorNear(3.85, 11.5)).resolves.toBe(2.5);
  });

  it('fail-open sans Neo4j', async () => {
    const empty = new GraphMapIntelligenceService(undefined);
    await expect(empty.courierIdsAvailableInRegion('CM')).resolves.toEqual([]);
    await expect(empty.averageTrafficFactorNear(1, 2)).resolves.toBeNull();
  });
});
