export type RequestStatsKind = 'http' | 'ws';

export type RequestStatsEntry = {
  id: string;
  kind: RequestStatsKind;
  method: string;
  route: string;
  storeId: string | null;
  statusCode: number | null;
  durationMs: number;
  userId: string | null;
  at: string;
  /** Service source (api process). */
  source: 'api' | 'ws';
};

export type RequestStatsQuery = {
  storeId?: string;
  kind?: RequestStatsKind | 'all';
  method?: string;
  routeContains?: string;
  minDurationMs?: number;
  sortBy?: 'at' | 'duration';
  limit?: number;
};

export type RequestStatsSlowRouteRow = {
  route: string;
  method: string;
  count: number;
  avgMs: number;
  maxMs: number;
};

export type RequestStatsSlowInsights = {
  thresholdMs: number;
  slowCount: number;
  totalInScope: number;
  slowRatePct: number;
  maxMs: number;
  p95Ms: number;
  avgSlowMs: number;
  bySource: { api: number; ws: number };
  byRoute: RequestStatsSlowRouteRow[];
};
