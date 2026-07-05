export type MapGeocodeOperation = 'forward' | 'reverse' | 'structured';

export type MapGeocodeUsageSource = 'cache_hit' | 'external';

export type MapGeocodeUsageRecord = {
  operation: MapGeocodeOperation;
  engine: string;
  source: MapGeocodeUsageSource;
  context?: string;
};

export type MapGeocodeUsageOperationStats = {
  operation: MapGeocodeOperation;
  total: number;
  cacheHits: number;
  externalCalls: number;
};

export type MapGeocodeUsageEngineStats = {
  engine: string;
  cacheHits: number;
  externalCalls: number;
};

export type MapGeocodeUsageContextStats = {
  context: string;
  total: number;
};

export type MapGeocodeRuntimeUsageSnapshot = {
  trackedSince: string;
  requests: {
    total: number;
    cacheHits: number;
    externalCalls: number;
    cacheHitRatePercent: number;
  };
  byOperation: MapGeocodeUsageOperationStats[];
  byEngine: MapGeocodeUsageEngineStats[];
  byContext: MapGeocodeUsageContextStats[];
};
