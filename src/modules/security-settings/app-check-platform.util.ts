import type { Request } from 'express';

export type AppCheckPlatform =
  | 'mobile'
  | 'web'
  | 'admin'
  | 'websocket'
  | 'unknown';

export type AppCheckPlatformFlags = {
  mobile: boolean;
  web: boolean;
  admin: boolean;
  websocket: boolean;
  api: boolean;
};

export function detectAppCheckPlatform(req: Request): AppCheckPlatform {
  const client = String(req.headers['x-client-platform'] ?? '')
    .trim()
    .toLowerCase();
  if (client === 'mobile') return 'mobile';
  if (client === 'web') return 'web';
  if (client === 'websocket' || client === 'ws') return 'websocket';

  const dashboard = String(req.headers['x-dashboard-client'] ?? '')
    .trim()
    .toLowerCase();
  if (dashboard.length > 0) return 'admin';

  return 'unknown';
}

export function isAppCheckRequiredForPlatform(
  platform: AppCheckPlatform,
  flags: AppCheckPlatformFlags,
): boolean {
  if (!flags.api) return false;
  if (platform === 'unknown') return false;
  return flags[platform] === true;
}
