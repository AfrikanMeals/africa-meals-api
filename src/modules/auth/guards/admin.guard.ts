import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: UserModel }>();
    const user = req.user;
    if (!user || user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('Accès réservé aux comptes ADMIN.');
    }
    return true;
  }
}
