import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CHECK_HEADER, AppCheckService } from './app-check.service';
import { detectAppCheckPlatform } from './app-check-platform.util';
import { SecuritySettingsService } from './security-settings.service';

function normalizePath(url: string): string {
  const raw = url ?? '';
  const q = raw.indexOf('?');
  let path = q === -1 ? raw : raw.slice(0, q);
  while (path === '/api' || path.startsWith('/api/')) {
    path = path === '/api' ? '/' : path.slice('/api'.length) || '/';
  }
  return path;
}

function isAppCheckExempt(method: string, path: string): boolean {
  if (method === 'OPTIONS') return true;
  if (path === '/health' || path.startsWith('/health/')) return true;
  if (path.startsWith('/internal/')) return true;
  if (path.includes('/stripe/webhook')) return true;
  if (method === 'GET' && path.startsWith('/platform/')) return true;
  return false;
}

@Injectable()
export class AppCheckGuard implements CanActivate {
  constructor(
    private readonly securitySettings: SecuritySettingsService,
    private readonly appCheck: AppCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const method = String(req.method ?? 'GET').toUpperCase();
    const path = normalizePath(req.url ?? req.path ?? '/');

    if (isAppCheckExempt(method, path)) {
      return true;
    }

    const platform = detectAppCheckPlatform(req);
    const required =
      await this.securitySettings.isAppCheckRequiredForPlatform(platform);
    if (!required) {
      return true;
    }

    const header = req.headers[APP_CHECK_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    await this.appCheck.verifyRequestToken(
      typeof token === 'string' ? token : undefined,
    );
    return true;
  }
}
