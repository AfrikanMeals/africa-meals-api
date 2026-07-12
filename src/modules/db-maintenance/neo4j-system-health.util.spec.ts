import {
  setGraphRuntimeFlagOverrides,
} from '@modules/graphdb-settings/graph-config.util';
import {
  isNeo4jUriConfigured,
  mapNeo4jHealthToSystemCheck,
} from './neo4j-system-health.util';

describe('neo4j-system-health.util', () => {
  afterEach(() => {
    setGraphRuntimeFlagOverrides(null);
  });

  it('maps disabled → degraded', () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: false,
      recoGraphEnabled: false,
      graphSyncEnabled: false,
    });
    const mapped = mapNeo4jHealthToSystemCheck({
      health: 'disabled',
      uriConfigured: true,
      env: {},
    });
    expect(mapped.status).toBe('degraded');
    expect(mapped.details).toContain('désactivé');
    expect(mapped.details).toContain('neo4j=off');
  });

  it('maps up → healthy with flags', () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: true,
      graphSyncEnabled: true,
    });
    const mapped = mapNeo4jHealthToSystemCheck({
      health: 'up',
      uriConfigured: true,
      env: {},
    });
    expect(mapped.status).toBe('healthy');
    expect(mapped.details).toContain('Ping Neo4j OK');
    expect(mapped.details).toContain('reco=on');
    expect(mapped.details).toContain('sync=on');
  });

  it('maps down without URI → down + message URI', () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: false,
      graphSyncEnabled: false,
    });
    const mapped = mapNeo4jHealthToSystemCheck({
      health: 'down',
      uriConfigured: false,
      env: {},
    });
    expect(mapped.status).toBe('down');
    expect(mapped.details).toContain('NEO4J_URI manquante');
  });

  it('isNeo4jUriConfigured reads NEO4J_URI', () => {
    expect(isNeo4jUriConfigured({ NEO4J_URI: 'bolt://localhost:7687' })).toBe(
      true,
    );
    expect(isNeo4jUriConfigured({ NEO4J_URI: '  ' })).toBe(false);
    expect(isNeo4jUriConfigured({})).toBe(false);
  });
});
