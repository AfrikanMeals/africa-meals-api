import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { lastValueFrom } from 'rxjs';
import { isObservable } from 'rxjs';

@Injectable()
export class OptionalAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.headers.authorization) {
      return true;
    }
    try {
      const result = super.canActivate(context);
      if (isObservable(result)) {
        return (await lastValueFrom(result)) as boolean;
      }
      if (result instanceof Promise) {
        return (await result) as boolean;
      }
      return result as boolean;
    } catch {
      return true;
    }
  }

  /** Jeton expiré ou invalide : pas d’utilisateur (ne pas faire échouer la requête). */
  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
