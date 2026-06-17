import { timingSafeEqualStrings } from '@common/security/timing-safe-equal.util';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly secrets: SecretManagerService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = await this.secrets.resolveString('api', 'INTERNAL_NOTIFY_SECRET');
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
    if (!timingSafeEqualStrings(provided, secret)) {
      throw new ForbiddenException('invalid_internal_secret');
    }
    return true;
  }
}
