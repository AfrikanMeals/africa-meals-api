/** Clé légère pour dedup SSE health (OPT-012) — évite JSON.stringify complet. */
export function sseHealthDedupKey(payload: Record<string, unknown>): string {
  const type = String(payload.type ?? '');
  if (type === 'mqtt') {
    const mqtt = payload.mqtt as Record<string, unknown> | undefined;
    return `mqtt:${String(mqtt?.state ?? '')}:${String(payload.checkedAt ?? '')}`;
  }
  if (type === 'snapshot') {
    const checks = payload.checks;
    const runtime = payload.runtime as Record<string, unknown> | undefined;
    let checksKey = '';
    if (Array.isArray(checks)) {
      checksKey = checks
        .map((c) => {
          const row = c as Record<string, unknown>;
          return `${String(row.key ?? '')}:${String(row.status ?? '')}`;
        })
        .join('|');
    }
    return `snap:${checksKey}:${String(runtime?.redisManagerEnabled ?? '')}:${String(runtime?.mqBrokerEnabled ?? '')}:${String(payload.checkedAt ?? '')}`;
  }
  return `other:${type}:${String(payload.checkedAt ?? '')}`;
}
