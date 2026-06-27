import { MaintenancePlatformEnum } from '@schemas/platform-maintenance.schema';
import { UserTypeEnum } from '@schemas/user.schema';
import type { Request } from 'express';
import type { PublicPlatformMaintenanceResponse } from './platform-maintenance.util';

const WHITELIST_PREFIXES = [
  '/platform/maintenance-mode',
  '/sse/public/platform-maintenance',
  '/auth/',
  '/health',
  '/docs',
  '/swagger',
  '/internal/',
  '/stripe/webhook',
  '/webhooks/stripe',
  '/medias/public/',
  '/acme-challenge/',
] as const;

export function normalizeApiPath(raw: string): string {
  const path = raw.split('?')[0] ?? raw;
  if (path.startsWith('/api/')) return path.slice('/api'.length) || '/';
  return path || '/';
}

export function isPlatformMaintenanceWhitelisted(path: string): boolean {
  const normalized = normalizeApiPath(path);
  return WHITELIST_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

export function readMobileAppUiMode(
  header: string | string[] | undefined,
): MaintenancePlatformEnum {
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  switch (value) {
    case MaintenancePlatformEnum.VENDOR:
      return MaintenancePlatformEnum.VENDOR;
    case MaintenancePlatformEnum.DELIVERY:
      return MaintenancePlatformEnum.DELIVERY;
    default:
      return MaintenancePlatformEnum.CUSTOMER;
  }
}

export function isMobileClientRequest(req: Request): boolean {
  const platform = String(req.headers['x-client-platform'] ?? '')
    .trim()
    .toLowerCase();
  return platform === 'mobile';
}

/** Dashboard admin web (vendeur ou admin) — hors périmètre maintenance mobile. */
export function isAdminWebDashboardRequest(req: Request): boolean {
  const client = String(req.headers['x-dashboard-client'] ?? '')
    .trim()
    .toLowerCase();
  return client === 'admin-web';
}

export function isAdminJwtRequest(req: Request): boolean {
  const auth = String(req.headers.authorization ?? '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { type?: unknown };
    return String(payload.type ?? '').trim().toUpperCase() === UserTypeEnum.ADMIN;
  } catch {
    return false;
  }
}

export function maintenanceEntryForMode(
  snapshot: PublicPlatformMaintenanceResponse,
  mode: MaintenancePlatformEnum,
) {
  switch (mode) {
    case MaintenancePlatformEnum.VENDOR:
      return snapshot.vendor;
    case MaintenancePlatformEnum.DELIVERY:
      return snapshot.delivery;
    default:
      return snapshot.customer;
  }
}
