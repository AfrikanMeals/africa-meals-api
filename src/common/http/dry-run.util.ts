import type { Request } from 'express';
import { isAcmeChallengePath } from './acme-challenge.middleware';

export const DRY_RUN_FLAG_HEADER = 'x-wise-eat-dry-run';
export const DRY_RUN_TOKEN_HEADER = 'x-wise-eat-dry-run-token';
export const DRY_RUN_MODE_HEADER = 'x-wise-eat-dry-run-mode';

export type DryRunConfig = {
  enabled: boolean;
  secret: string;
};

export type DryRunSimulatedResponse = {
  status: number;
  body: Record<string, unknown> | null;
};

function parseBooleanEnv(raw: string | undefined, fallback = false): boolean {
  const v = String(raw ?? (fallback ? 'true' : 'false'))
    .trim()
    .toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

export function readDryRunConfig(env: NodeJS.ProcessEnv = process.env): DryRunConfig {
  return {
    enabled: parseBooleanEnv(env.DRY_RUN_ENABLED, false),
    secret: String(env.DRY_RUN_SECRET ?? '').trim(),
  };
}

export function dryRunFlagFromRequest(req: Request): string {
  const header = String(req.headers[DRY_RUN_FLAG_HEADER] ?? '').trim().toLowerCase();
  if (header) {
    return header;
  }
  const query = req.query?.dryRun;
  if (Array.isArray(query)) {
    return String(query[0] ?? '').trim().toLowerCase();
  }
  return String(query ?? '').trim().toLowerCase();
}

export function isDryRunFlagActive(raw: string): boolean {
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function dryRunTokenFromRequest(req: Request): string {
  return String(req.headers[DRY_RUN_TOKEN_HEADER] ?? '').trim();
}

export function isDryRunRequest(req: Request, cfg: DryRunConfig = readDryRunConfig()): boolean {
  if (!cfg.enabled || !cfg.secret) {
    return false;
  }
  if (!isDryRunFlagActive(dryRunFlagFromRequest(req))) {
    return false;
  }
  return dryRunTokenFromRequest(req) === cfg.secret;
}

export function isMutatingHttpMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

/** Routes qui doivent toujours s'exécuter (webhooks, auth tokens, interne). */
export function isDryRunAlwaysExecutePath(path: string): boolean {
  const p = path.toLowerCase();
  if (!p) {
    return false;
  }
  if (/\/health(?:\/|$)/.test(p)) return true;
  if (/\/metrics(?:\/|$)/.test(p)) return true;
  if (p === '/robots.txt' || p.endsWith('/robots.txt')) return true;
  if (isAcmeChallengePath(p)) return true;
  if (p.includes('/internal/')) return true;
  if (p.includes('/stripe/webhook') || p.includes('/billing/stripe/webhook')) {
    return true;
  }
  if (/\/auth\/(?:login|refresh|google|apple|facebook|admin\/google)(?:\/|$)/.test(p)) {
    return true;
  }
  if (/\/auth\/login\/verify-2fa(?:\/|$)/.test(p)) {
    return true;
  }
  return false;
}

export function isGraphqlMutationRequest(req: Request): boolean {
  const body = req.body as { query?: unknown; operationName?: unknown } | undefined;
  const query = typeof body?.query === 'string' ? body.query : '';
  if (!query.trim()) {
    return false;
  }
  return /^\s*mutation\b/im.test(query);
}

export function shouldSimulateDryRunMutation(
  req: Request,
  path: string,
  method: string,
): boolean {
  if (!isMutatingHttpMethod(method)) {
    return false;
  }
  if (isDryRunAlwaysExecutePath(path)) {
    return false;
  }
  if (/\/graphql(?:\/|$)/i.test(path) && !isGraphqlMutationRequest(req)) {
    return false;
  }
  return true;
}

export function buildDryRunSimulatedResponse(
  method: string,
  path: string,
): DryRunSimulatedResponse {
  const m = method.toUpperCase();
  const status = m === 'POST' ? 201 : m === 'DELETE' ? 204 : 200;
  if (status === 204) {
    return { status, body: null };
  }
  return {
    status,
    body: {
      dryRun: true,
      simulated: true,
      method: m,
      path,
      message: 'Mutation skipped — Wise Eat dry run (no data written)',
    },
  };
}
