import type { Request } from 'express';

const DASHBOARD_CLIENT_HEADER = 'x-dashboard-client';

export const DASHBOARD_AUDIT_SKIP_PATH_MARKERS = [
  '/health',
  '/docs',
  '/favicon',
  '/dashboard-audit',
  '/auth/refresh',
  '/auth/me',
  '/auth/me/fcm-token',
  '/request-stats',
];

export function isDashboardWebClient(req: Request): boolean {
  const v = String(req.headers[DASHBOARD_CLIENT_HEADER] ?? '')
    .trim()
    .toLowerCase();
  return v === 'admin-web';
}

export function shouldSkipDashboardAuditHttpPath(path: string): boolean {
  const p = (path.split('?')[0] ?? path).toLowerCase();
  if (p === '/' || p === '/api' || p === '') return true;
  return DASHBOARD_AUDIT_SKIP_PATH_MARKERS.some(
    (marker) => p.includes(marker),
  );
}

export function dashboardPathFromRequest(req: Request): string | undefined {
  const raw = req.headers['x-dashboard-path'];
  const path =
    typeof raw === 'string'
      ? raw.trim()
      : Array.isArray(raw)
        ? String(raw[0] ?? '').trim()
        : '';
  if (path.startsWith('/')) return path.slice(0, 512);
  return undefined;
}

export function inferDashboardAuditCategory(
  dashboardPath: string | undefined,
  apiPath: string,
): string {
  const p = `${dashboardPath ?? ''} ${apiPath}`.toLowerCase();
  if (p.includes('/admin')) return 'admin';
  if (p.includes('/marketing')) return 'marketing';
  if (p.includes('/commandes') || p.includes('/orders')) return 'orders';
  if (p.includes('/catalogue') || p.includes('/products')) return 'catalog';
  if (p.includes('/finances') || p.includes('/billing')) return 'finances';
  if (p.includes('/chat')) return 'chat';
  if (p.includes('/settings')) return 'settings';
  if (p.includes('/livraisons') || p.includes('/delivery')) return 'delivery';
  if (p.includes('/equipe') || p.includes('/teams')) return 'team';
  if (p.includes('/dashboard')) return 'dashboard';
  return 'general';
}

export function dashboardApiActionFromMethod(method: string): string {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
    ? 'API_MUTATION'
    : 'API_READ';
}

export function normalizeDashboardApiPath(path: string): string {
  const p = path.split('?')[0] ?? path;
  return p.length > 512 ? `${p.slice(0, 512)}…` : p;
}
