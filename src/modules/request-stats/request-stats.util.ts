import type { Request } from 'express';

const OBJECT_ID_RE =
  /\b[0-9a-fA-F]{24}\b/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const SKIP_PATH_PREFIXES = [
  '/health',
  '/docs',
  '/favicon',
  '/request-stats/admin',
];

export function isRequestStatsEnabled(raw: string | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v !== 'false' && v !== '0';
}

export function requestStatsMaxEntries(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 500 && n <= 50_000) return Math.floor(n);
  return 10_000;
}

export function shouldSkipRequestStatsPath(path: string): boolean {
  const p = path.split('?')[0] ?? path;
  if (p === '/') return true;
  return SKIP_PATH_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`),
  );
}

export function normalizeRequestRoute(path: string): string {
  let p = path.split('?')[0] ?? path;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(OBJECT_ID_RE, ':id');
  p = p.replace(UUID_RE, ':id');
  return p.length > 240 ? `${p.slice(0, 240)}…` : p;
}

export function extractStoreIdFromRequest(req: Request): string | null {
  const params = req.params as Record<string, string | undefined>;
  const fromParam =
    params.storeId?.trim() ||
    params.store_id?.trim() ||
    params.id?.trim();
  if (fromParam && /^[0-9a-fA-F]{24}$/.test(fromParam)) {
    const path = req.path ?? req.url ?? '';
    if (/\/stores\//i.test(path)) return fromParam;
  }

  const q = req.query as Record<string, string | string[] | undefined>;
  const qStore = q.storeId ?? q.store_id;
  const fromQuery =
    typeof qStore === 'string'
      ? qStore.trim()
      : Array.isArray(qStore)
        ? String(qStore[0] ?? '').trim()
        : '';
  if (fromQuery && /^[0-9a-fA-F]{24}$/.test(fromQuery)) return fromQuery;

  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object') {
    const raw = body.storeId ?? body.store_id ?? body.store;
    const id =
      typeof raw === 'string'
        ? raw.trim()
        : raw && typeof raw === 'object' && '_id' in (raw as object)
          ? String((raw as { _id?: unknown })._id ?? '').trim()
          : '';
    if (id && /^[0-9a-fA-F]{24}$/.test(id)) return id;
  }

  const pathOnly = (req.path ?? req.url ?? '').split('?')[0] ?? '';
  const m = pathOnly.match(/\/stores\/([0-9a-fA-F]{24})(?:\/|$)/i);
  if (m?.[1]) return m[1];

  return null;
}
