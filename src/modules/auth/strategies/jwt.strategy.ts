import { AuthService } from '@modules/auth/auth.service';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    //@InjectModel(UserModel.name) private readonly _usersModel: Model<UserModel>,
    @Inject(AuthService) private readonly _authService: AuthService,
    @Inject(ConfigService) private readonly _configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secret: _configService.get<string>('JWT_SECRET'),
      secretOrKey: _configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub?: string; typ?: string }) {
    if (payload?.typ && payload.typ !== 'access') {
      throw new UnauthorizedException('invalid_access_token');
    }
    const user = await this._authService.findUserById(payload.sub ?? '');
    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
