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
  limit?: number;
};
