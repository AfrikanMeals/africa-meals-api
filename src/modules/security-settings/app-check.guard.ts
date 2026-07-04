import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { APP_CHECK_HEADER, AppCheckService } from './app-check.service';
import { detectAppCheckPlatform } from './app-check-platform.util';
import { SecuritySettingsService } from './security-settings.service';

function resolveHttpRequest(context: ExecutionContext): Request | undefined {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext()?.req as
      | Request
      | undefined;
  }
  return context.switchToHttp().getRequest<Request>();
}

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
  if (path === '/metrics' || path.startsWith('/metrics/')) return true;
  if (path.startsWith('/internal/')) return true;
  if (path.includes('/stripe/webhook')) return true;
  if (method === 'GET' && path.startsWith('/platform/')) return true;
  // Mint session / release — pas de jeton préalable (œuf/poule).
  if (
    method === 'POST' &&
    (path === '/platform/security-settings/app-check-session' ||
      path === '/platform/security-settings/app-check-token')
  ) {
    return true;
  }
  if (method === 'GET' && path.startsWith('/medias/public/')) return true;
  if (path === '/auth/refresh') return true;
  return false;
}

@Injectable()
export class AppCheckGuard implements CanActivate {
  private readonly logger = new Logger(AppCheckGuard.name);

  constructor(
    private readonly securitySettings: SecuritySettingsService,
    private readonly appCheck: AppCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = resolveHttpRequest(context);
    if (!req) {
      return true;
    }
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
    const hasToken = typeof token === 'string' && token.trim().length > 0;
    if (!hasToken) {
      this.logger.warn(
        `App Check token missing platform=${platform} ${method} ${path}`,
      );
    }
    await this.appCheck.verifyRequestToken(
      typeof token === 'string' ? token : undefined,
    );
    return true;
  }
}
