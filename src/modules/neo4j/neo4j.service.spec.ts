import {
  isNeo4jEnabled,
  setGraphRuntimeFlagOverrides,
} from '@modules/graphdb-settings/graph-config.util';
import { Neo4jService } from './neo4j.service';

describe('Neo4jService.syncWithRuntimeFlags', () => {
  afterEach(() => {
    setGraphRuntimeFlagOverrides(null);
  });

  it('returns disabled and does not require URI when flags off', async () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: false,
      recoGraphEnabled: false,
      graphSyncEnabled: false,
    });
    expect(isNeo4jEnabled()).toBe(false);
    const svc = new Neo4jService();
    await expect(svc.syncWithRuntimeFlags()).resolves.toBe('disabled');
    await expect(svc.ensureHealthy()).resolves.toBe(false);
  });

  it('returns down when enabled but NEO4J_URI missing', async () => {
    const prev = process.env.NEO4J_URI;
    delete process.env.NEO4J_URI;
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: false,
      graphSyncEnabled: false,
    });
    const svc = new Neo4jService();
    await expect(svc.syncWithRuntimeFlags()).resolves.toBe('down');
    await expect(svc.ensureHealthy()).resolves.toBe(false);
    if (prev != null) process.env.NEO4J_URI = prev;
  });

  it('ensureHealthy follows runtime toggle OFF after ON attempt', async () => {
    delete process.env.NEO4J_URI;
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const svc = new Neo4jService();
    await svc.syncWithRuntimeFlags();
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: false,
      recoGraphEnabled: false,
      graphSyncEnabled: false,
    });
    await expect(svc.syncWithRuntimeFlags()).resolves.toBe('disabled');
    await expect(svc.ensureHealthy()).resolves.toBe(false);
  });
});
