import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim();
    if (!secret) {
      throw new ForbiddenException('internal_notify_disabled');
    }
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-internal-secret'];
    const provided =
      typeof header === 'string'
        ? header
        : Array.isArray(header)
        ? header[0]
        : '';
    if (provided !== secret) {
      throw new ForbiddenException('invalid_internal_secret');
    }
    return true;
  }
}
