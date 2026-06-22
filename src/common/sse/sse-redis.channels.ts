/** Canaux Redis pub/sub + clés snapshot pour SSE hébergé sur africa-meals-ws (POLL-000). */

export const SSE_REDIS_LAST_TTL_SEC = 86_400;

export const SSE_REDIS_CHANNELS = {
  reindex: 'sse:ch:reindex',
  fleet: 'sse:ch:fleet',
  health: 'sse:ch:health',
  status: 'sse:ch:status',
  job: (jobId: string) => `sse:ch:job:${jobId.trim()}`,
  checkout: (sessionId: string) => `sse:ch:checkout:${sessionId.trim()}`,
  requestStats: 'sse:ch:request-stats',
  platformMaintenance: 'sse:ch:platform-maintenance',
} as const;

export const SSE_REDIS_LAST_KEYS = {
  reindex: 'sse:last:reindex',
  fleet: 'sse:last:fleet',
  health: 'sse:last:health',
  status: 'sse:last:status',
  job: (jobId: string) => `sse:last:job:${jobId.trim()}`,
  checkout: (sessionId: string) => `sse:last:checkout:${sessionId.trim()}`,
  requestStats: 'sse:last:request-stats',
  platformMaintenance: 'sse:last:platform-maintenance',
} as const;

export function isSseHostOnWs(): boolean {
  const v = (process.env.SSE_HOST_ON_WS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isSseHttpOnApi(): boolean {
  if (isSseHostOnWs()) return false;
  const v = (process.env.SSE_HTTP_ON_API ?? 'true').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

export function isSseRedisBridgeEnabled(): boolean {
  const v = (process.env.SSE_REDIS_BRIDGE_ENABLED ?? 'true')
    .trim()
    .toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}
