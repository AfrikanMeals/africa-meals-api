/**
 * Neo4j / GraphDB — parsing env + contrat flags effectifs (fail-open Mongo).
 * @see africa-meals-project/docs/NEO4J_INTEGRATION.md §10
 */

export type GraphDbFlagKey =
  | 'neo4jEnabled'
  | 'recoGraphEnabled'
  | 'graphSyncEnabled';

export type GraphDbStoredFlags = {
  neo4jEnabled: boolean;
  recoGraphEnabled: boolean;
  graphSyncEnabled: boolean;
};

export type GraphDbEffectiveFlags = {
  /** Driver / health / jobs batch — kill-switch global. */
  neo4jEnabled: boolean;
  /** Lectures reco Neo4j (no-op si neo4j off). */
  recoGraphEnabled: boolean;
  /** Écritures sync outbox / BullMQ (no-op si neo4j off). */
  graphSyncEnabled: boolean;
};

/** Opt-in : true / 1 / yes / on uniquement ; défaut false. */
export function parseOptInBoolean(
  raw: string | undefined | null,
  fallback = false,
): boolean {
  if (raw == null || String(raw).trim() === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function graphFlagsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GraphDbStoredFlags {
  return {
    neo4jEnabled: parseOptInBoolean(env.NEO4J_ENABLED, false),
    recoGraphEnabled: parseOptInBoolean(env.RECO_GRAPH_ENABLED, false),
    graphSyncEnabled: parseOptInBoolean(env.GRAPH_SYNC_ENABLED, false),
  };
}

/**
 * Règle : RECO_GRAPH / GRAPH_SYNC sont no-op si NEO4J_ENABLED effectif = false.
 */
export function resolveEffectiveGraphFlags(
  stored: GraphDbStoredFlags,
): GraphDbEffectiveFlags {
  const neo4jEnabled = stored.neo4jEnabled === true;
  return {
    neo4jEnabled,
    recoGraphEnabled: neo4jEnabled && stored.recoGraphEnabled === true,
    graphSyncEnabled: neo4jEnabled && stored.graphSyncEnabled === true,
  };
}

/** Matrice d’activation documentée (tests / UI). */
export type GraphActivationRow = {
  neo4jEnabled: boolean;
  recoGraphEnabled: boolean;
  graphSyncEnabled: boolean;
  behavior: string;
};

export const GRAPH_ACTIVATION_MATRIX: GraphActivationRow[] = [
  {
    neo4jEnabled: false,
    recoGraphEnabled: false,
    graphSyncEnabled: false,
    behavior: 'Mongo only. Pas de driver, pas de jobs graph.',
  },
  {
    neo4jEnabled: true,
    recoGraphEnabled: false,
    graphSyncEnabled: false,
    behavior: 'Driver up (health) mais pas de reco graphe ni sync.',
  },
  {
    neo4jEnabled: true,
    recoGraphEnabled: false,
    graphSyncEnabled: true,
    behavior: 'Sync remplit le graphe ; clients voient encore reco Mongo.',
  },
  {
    neo4jEnabled: true,
    recoGraphEnabled: true,
    graphSyncEnabled: true,
    behavior: 'Prod graphe : sync + lectures reco Neo4j (fail-open si down).',
  },
  {
    neo4jEnabled: true,
    recoGraphEnabled: true,
    graphSyncEnabled: false,
    behavior: 'Lecture seule (graphe déjà peuplé) — freeze writes.',
  },
];

let runtimeOverrides: GraphDbStoredFlags | null = null;

export function setGraphRuntimeFlagOverrides(
  flags: GraphDbStoredFlags | null,
): void {
  runtimeOverrides = flags
    ? {
        neo4jEnabled: flags.neo4jEnabled === true,
        recoGraphEnabled: flags.recoGraphEnabled === true,
        graphSyncEnabled: flags.graphSyncEnabled === true,
      }
    : null;
}

export function getGraphRuntimeStoredFlags(
  env: NodeJS.ProcessEnv = process.env,
): GraphDbStoredFlags {
  return runtimeOverrides ?? graphFlagsFromEnv(env);
}

export function isNeo4jEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEffectiveGraphFlags(getGraphRuntimeStoredFlags(env))
    .neo4jEnabled;
}

export function isRecoGraphEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveEffectiveGraphFlags(getGraphRuntimeStoredFlags(env))
    .recoGraphEnabled;
}

export function isGraphSyncEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveEffectiveGraphFlags(getGraphRuntimeStoredFlags(env))
    .graphSyncEnabled;
}

/**
 * Contrat fail-open : si Neo4j down ou flags off → Mongo.
 * `neo4jHealthy` vient du healthcheck driver (optionnel).
 */
export function shouldUseGraphRecommendations(opts: {
  neo4jHealthy?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isRecoGraphEnabled(opts.env)) return false;
  if (opts.neo4jHealthy === false) return false;
  return true;
}

export function shouldEnqueueGraphSync(opts?: {
  env?: NodeJS.ProcessEnv;
}): boolean {
  return isGraphSyncEnabled(opts?.env);
}

const DEFAULT_RECO_GRAPH_TIMEOUT_MS = 200;
const DEFAULT_GRAPH_SYNC_QUEUE = 'graph-sync';

/**
 * Timeout lectures Cypher reco (ms). Defaut 200 ; min 50, max 5000.
 */
export function parseRecoGraphTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.RECO_GRAPH_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RECO_GRAPH_TIMEOUT_MS;
  return Math.min(5000, Math.max(50, Math.floor(n)));
}

/** Nom de file BullMQ graph-sync (defaut `graph-sync`). */
export function parseGraphSyncQueueName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.GRAPH_SYNC_QUEUE ?? '').trim();
  return raw || DEFAULT_GRAPH_SYNC_QUEUE;
}
