export function escPrometheusLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function prometheusLine(
  name: string,
  value: number,
  labels?: Record<string, string>,
): string {
  if (!labels || !Object.keys(labels).length) {
    return `${name} ${value}`;
  }
  const parts = Object.entries(labels)
    .map(([k, v]) => `${k}="${escPrometheusLabel(v)}"`)
    .join(',');
  return `${name}{${parts}} ${value}`;
}

export function httpStatusClass(statusCode: number | null | undefined): string {
  if (statusCode == null || !Number.isFinite(statusCode)) return 'unknown';
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return 'other';
}

export function normalizePrometheusRoute(route: string): string {
  const raw = String(route ?? '').trim() || '/unknown';
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

export function normalizePrometheusMethod(method: string): string {
  const raw = String(method ?? '').trim().toUpperCase() || 'UNKNOWN';
  return raw.length > 16 ? raw.slice(0, 16) : raw;
}
