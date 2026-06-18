import { Logger } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { isCorsOriginAllowed } from './cors-origin-match.util';

/** Origines locales par défaut en dev si `CORS_ORIGIN` est absent (H-01). */
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5000',
  'http://localhost:5002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5002',
] as const;

const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Cache-Control',
  'Pragma',
  'ngrok-skip-browser-warning',
  'x-dashboard-client',
  'x-dashboard-path',
  'x-dashboard-resource-name',
  'x-no-auth-refresh',
  'x-auth-refresh-retry',
  'x-client-platform',
  'X-Firebase-AppCheck',
  'x-firebase-appcheck',
] as const;

export function normalizeCorsOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function parseCorsOrigins(raw: string | undefined): Set<string> {
  const items = (raw ?? '')
    .split(',')
    .map(normalizeCorsOrigin)
    .filter(Boolean);
  return new Set(items);
}

function isProductionEnv(): boolean {
  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  return env === 'production' || env === 'prod';
}

/**
 * Allowlist CORS (H-01) — remplace `origin: true`.
 * - `CORS_ORIGIN` : liste séparée par des virgules ; supporte `https://*.wise-eat.com`.
 * - Toujours autorisé : sous-domaines `*.wise-eat.com` (http/https).
 * - Clients sans en-tête `Origin` (app mobile native, serveur) : autorisés.
 * - Dev sans `CORS_ORIGIN` : localhost uniquement (pas toutes les origines).
 */
export function buildApiCorsOptions(): CorsOptions {
  const configured = parseCorsOrigins(process.env.CORS_ORIGIN);
  const isProd = isProductionEnv();
  const allowed =
    configured.size > 0
      ? configured
      : isProd
        ? configured
        : new Set<string>(DEFAULT_DEV_ORIGINS);

  if (isProd && configured.size === 0) {
    Logger.warn(
      'CORS_ORIGIN is empty in production — seuls les sous-domaines *.wise-eat.com (http/https) et les apps sans Origin sont autorisés (H-01)',
      'CorsOptions',
    );
  }

  return buildCorsOptionsFromAllowlist(allowed);
}

/** Vérifie si une origine navigateur est autorisée (allowlist + `*.wise-eat.com`). */
export function isBrowserCorsOriginAllowed(origin: string): boolean {
  const configured = parseCorsOrigins(process.env.CORS_ORIGIN);
  const isProd = isProductionEnv();
  const allowed =
    configured.size > 0
      ? configured
      : isProd
        ? configured
        : new Set<string>(DEFAULT_DEV_ORIGINS);
  return isCorsOriginAllowed(normalizeCorsOrigin(origin), allowed);
}

function buildCorsOptionsFromAllowlist(allowed: Set<string>): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = normalizeCorsOrigin(origin);
      if (isCorsOriginAllowed(normalized, allowed)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
  };
}
