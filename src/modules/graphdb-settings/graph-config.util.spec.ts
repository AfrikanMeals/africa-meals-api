import {
  GRAPH_ACTIVATION_MATRIX,
  graphFlagsFromEnv,
  isGraphSyncEnabled,
  isNeo4jEnabled,
  isRecoGraphEnabled,
  parseOptInBoolean,
  resolveEffectiveGraphFlags,
  setGraphRuntimeFlagOverrides,
  shouldEnqueueGraphSync,
  shouldUseGraphRecommendations,
} from './graph-config.util';

describe('graph-config.util', () => {
  afterEach(() => {
    setGraphRuntimeFlagOverrides(null);
  });

  describe('parseOptInBoolean', () => {
    it('defaults to false', () => {
      expect(parseOptInBoolean(undefined)).toBe(false);
      expect(parseOptInBoolean('')).toBe(false);
      expect(parseOptInBoolean('maybe')).toBe(false);
      expect(parseOptInBoolean('false')).toBe(false);
    });

    it('accepts true / 1 / yes / on', () => {
      expect(parseOptInBoolean('true')).toBe(true);
      expect(parseOptInBoolean('TRUE')).toBe(true);
      expect(parseOptInBoolean('1')).toBe(true);
      expect(parseOptInBoolean('yes')).toBe(true);
      expect(parseOptInBoolean('on')).toBe(true);
    });
  });

  describe('resolveEffectiveGraphFlags', () => {
    it('forces child flags off when neo4j is off', () => {
      expect(
        resolveEffectiveGraphFlags({
          neo4jEnabled: false,
          recoGraphEnabled: true,
          graphSyncEnabled: true,
        }),
      ).toEqual({
        neo4jEnabled: false,
        recoGraphEnabled: false,
        graphSyncEnabled: false,
      });
    });

    it('honors child flags when neo4j is on', () => {
      expect(
        resolveEffectiveGraphFlags({
          neo4jEnabled: true,
          recoGraphEnabled: true,
          graphSyncEnabled: false,
        }),
      ).toEqual({
        neo4jEnabled: true,
        recoGraphEnabled: true,
        graphSyncEnabled: false,
      });
    });
  });

  describe('runtime overrides + env', () => {
    it('reads env when no override', () => {
      const env = {
        NEO4J_ENABLED: 'true',
        RECO_GRAPH_ENABLED: 'false',
        GRAPH_SYNC_ENABLED: 'true',
      } as NodeJS.ProcessEnv;
      expect(graphFlagsFromEnv(env)).toEqual({
        neo4jEnabled: true,
        recoGraphEnabled: false,
        graphSyncEnabled: true,
      });
      expect(isNeo4jEnabled(env)).toBe(true);
      expect(isRecoGraphEnabled(env)).toBe(false);
      expect(isGraphSyncEnabled(env)).toBe(true);
    });

    it('prefers Mongo runtime overrides over env', () => {
      setGraphRuntimeFlagOverrides({
        neo4jEnabled: true,
        recoGraphEnabled: true,
        graphSyncEnabled: false,
      });
      const env = {
        NEO4J_ENABLED: 'false',
        RECO_GRAPH_ENABLED: 'false',
        GRAPH_SYNC_ENABLED: 'true',
      } as NodeJS.ProcessEnv;
      expect(isNeo4jEnabled(env)).toBe(true);
      expect(isRecoGraphEnabled(env)).toBe(true);
      expect(isGraphSyncEnabled(env)).toBe(false);
    });
  });

  describe('fail-open contracts', () => {
    it('shouldUseGraphRecommendations is false when flags off', () => {
      expect(shouldUseGraphRecommendations({ neo4jHealthy: true })).toBe(false);
    });

    it('shouldUseGraphRecommendations fails open when Neo4j unhealthy', () => {
      setGraphRuntimeFlagOverrides({
        neo4jEnabled: true,
        recoGraphEnabled: true,
        graphSyncEnabled: true,
      });
      expect(shouldUseGraphRecommendations({ neo4jHealthy: false })).toBe(
        false,
      );
      expect(shouldUseGraphRecommendations({ neo4jHealthy: true })).toBe(true);
      expect(shouldUseGraphRecommendations({})).toBe(true);
    });

    it('shouldEnqueueGraphSync follows effective sync flag', () => {
      expect(shouldEnqueueGraphSync()).toBe(false);
      setGraphRuntimeFlagOverrides({
        neo4jEnabled: true,
        recoGraphEnabled: false,
        graphSyncEnabled: true,
      });
      expect(shouldEnqueueGraphSync()).toBe(true);
    });
  });

  it('exposes activation matrix rows', () => {
    expect(GRAPH_ACTIVATION_MATRIX.length).toBeGreaterThanOrEqual(5);
    const off = GRAPH_ACTIVATION_MATRIX.find((r) => !r.neo4jEnabled);
    expect(off?.behavior).toMatch(/Mongo/i);
  });
});
