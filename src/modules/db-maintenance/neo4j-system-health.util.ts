import {
  isGraphSyncEnabled,
  isNeo4jEnabled,
  isRecoGraphEnabled,
} from '@modules/graphdb-settings/graph-config.util';

export type Neo4jHealthStateLike = 'disabled' | 'up' | 'down';

export type Neo4jSystemHealthMapped = {
  status: 'healthy' | 'degraded' | 'down';
  details: string;
};

/**
 * Mappe l’état Neo4j (+ flags effectifs) vers le contrat System Health admin.
 */
export function mapNeo4jHealthToSystemCheck(input: {
  health: Neo4jHealthStateLike;
  uriConfigured: boolean;
  env?: NodeJS.ProcessEnv;
}): Neo4jSystemHealthMapped {
  const env = input.env ?? process.env;
  const flags = `neo4j=${isNeo4jEnabled(env) ? 'on' : 'off'} · reco=${
    isRecoGraphEnabled(env) ? 'on' : 'off'
  } · sync=${isGraphSyncEnabled(env) ? 'on' : 'off'}`;
  const uri = input.uriConfigured ? 'URI ok' : 'URI manquante';

  if (input.health === 'disabled') {
    return {
      status: 'degraded',
      details: `Neo4j désactivé (flags env/Admin). ${flags} · ${uri}`,
    };
  }
  if (input.health === 'up') {
    return {
      status: 'healthy',
      details: `Ping Neo4j OK. ${flags} · ${uri}`,
    };
  }
  return {
    status: 'down',
    details: input.uriConfigured
      ? `Neo4j injoignable. ${flags} · ${uri}`
      : `Neo4j down — NEO4J_URI manquante. ${flags}`,
  };
}

export function isNeo4jUriConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(String(env.NEO4J_URI ?? '').trim());
}
