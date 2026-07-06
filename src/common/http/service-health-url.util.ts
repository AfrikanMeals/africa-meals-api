/**
 * Construit une URL …/api/health sans doubler `/api` lorsque la base
 * se termine déjà par `/api` ou `/api/health` (ex. proxy admin `…/wise-eat-api` → `…/api`).
 */
export function normalizeServiceBaseUrl(raw: string): string {
  let base = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';
  base = base.replace(/\/api\/health$/i, '');
  base = base.replace(/\/api$/i, '');
  return base.replace(/\/+$/, '');
}

export function serviceHealthUrl(base: string, fallback = 'http://localhost:9000/api/health'): string {
  const root = normalizeServiceBaseUrl(base);
  if (!root) return fallback;
  try {
    const url = new URL(root.startsWith('http') ? root : `http://${root}`);
    return `${url.origin}/api/health`;
  } catch {
    return `${root}/api/health`;
  }
}

/** Chemin sous le préfixe global `/api` (ex. `sse/public/status`). */
export function serviceApiSubpath(base: string, subpath: string): string {
  const root = normalizeServiceBaseUrl(base);
  const path = String(subpath ?? '').replace(/^\/+/, '');
  if (!root) return `/api/${path}`;
  try {
    const url = new URL(root.startsWith('http') ? root : `http://${root}`);
    return `${url.origin}/api/${path}`;
  } catch {
    return `${root}/api/${path}`;
  }
}
