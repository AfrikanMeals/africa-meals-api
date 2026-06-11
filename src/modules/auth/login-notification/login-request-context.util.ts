import { isDashboardWebClient } from '@modules/dashboard-audit/dashboard-audit.util';
import type { Request } from 'express';

export type LoginClientChannel = 'admin' | 'mobile';

export type LoginRequestContext = {
  channel: LoginClientChannel;
  ipAddress: string;
  userAgent: string;
  deviceType: string;
  os: string;
  browser: string;
  clientDevice?: string;
  dashboardPath?: string;
};

export type LoginAuthMethod =
  | 'email_password'
  | 'google'
  | 'apple'
  | 'facebook'
  | 'register';

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || 'Inconnu';
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim() || 'Inconnu';
  }
  return req.ip?.trim() || 'Inconnu';
}

export function detectLoginChannel(req: Request): LoginClientChannel {
  if (isDashboardWebClient(req)) return 'admin';
  const platform = String(req.headers['x-client-platform'] ?? '')
    .trim()
    .toLowerCase();
  if (platform === 'mobile') return 'mobile';
  return 'mobile';
}

function headerString(req: Request, name: string): string {
  const raw = req.headers[name];
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
  return '';
}

export function parseUserAgentSummary(
  userAgent: string,
  req?: Request,
): Pick<LoginRequestContext, 'deviceType' | 'os' | 'browser'> {
  const clientOs = req ? headerString(req, 'x-client-os') : '';
  const clientOsVersion = req ? headerString(req, 'x-client-os-version') : '';
  const raw = userAgent.trim() || 'Inconnu';
  const lower = raw.toLowerCase();

  let os = 'Inconnu';
  if (clientOs) {
    os = clientOsVersion ? `${clientOs} ${clientOsVersion}` : clientOs;
  } else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ios'))
    os = 'iOS';
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('linux')) os = 'Linux';
  else if (lower.includes('dart')) os = 'Application mobile';

  let browser = 'Inconnu';
  if (lower.includes('edg/')) browser = 'Microsoft Edge';
  else if (lower.includes('chrome/') && !lower.includes('edg/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome/'))
    browser = 'Safari';
  else if (lower.includes('dart')) browser = 'Wise Eat (app native)';

  let deviceType = 'Ordinateur';
  if (
    lower.includes('mobile') ||
    lower.includes('android') ||
    lower.includes('iphone')
  ) {
    deviceType = 'Mobile';
  } else if (lower.includes('ipad') || lower.includes('tablet')) {
    deviceType = 'Tablette';
  } else if (lower.includes('dart') || clientOs === 'android' || clientOs === 'ios') {
    deviceType = 'Mobile';
  }

  return { deviceType, os, browser };
}

export function buildLoginRequestContext(req: Request): LoginRequestContext {
  const userAgent = String(req.headers['user-agent'] ?? '').trim() || 'Inconnu';
  const parsed = parseUserAgentSummary(userAgent, req);
  const dashboardPathRaw = req.headers['x-dashboard-path'];
  const dashboardPath =
    typeof dashboardPathRaw === 'string' && dashboardPathRaw.startsWith('/')
      ? dashboardPathRaw.slice(0, 512)
      : undefined;

  return {
    channel: detectLoginChannel(req),
    ipAddress: clientIpFromRequest(req),
    userAgent: userAgent.slice(0, 512),
    ...parsed,
    clientDevice: headerString(req, 'x-client-device') || undefined,
    dashboardPath,
  };
}

export function loginMethodLabel(method: LoginAuthMethod): string {
  switch (method) {
    case 'email_password':
      return 'E-mail et mot de passe';
    case 'google':
      return 'Google';
    case 'apple':
      return 'Apple';
    case 'facebook':
      return 'Facebook';
    case 'register':
      return 'Création de compte';
    default:
      return method;
  }
}
