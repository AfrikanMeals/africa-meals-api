import { AuthService } from '@modules/auth/auth.service';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class SseJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('missing_token');
    }
    let payload: { sub?: string };
    try {
      payload = this.jwt.verify<{ sub?: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
    const userId = String(payload?.sub ?? '').trim();
    if (!userId) {
      throw new UnauthorizedException('invalid_token');
    }
    const user = await this.auth.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('user_not_found');
    }
    (req as Request & { user: unknown }).user = user;
    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length).trim() || null;
    }
    const q = req.query?.token;
    if (typeof q === 'string' && q.trim()) {
      return q.trim();
    }
    return null;
  }
}
