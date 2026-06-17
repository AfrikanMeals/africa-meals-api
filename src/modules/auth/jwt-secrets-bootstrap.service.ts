import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertJwtRefreshSecretsOnBoot } from './jwt-secrets.util';

@Injectable()
export class JwtSecretsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(JwtSecretsBootstrapService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    assertJwtRefreshSecretsOnBoot(this.config);
    this.logger.log('JWT refresh secret configuration validated');
  }
}
