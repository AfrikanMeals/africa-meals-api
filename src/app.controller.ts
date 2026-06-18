import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { PublicInfraStatusService } from './modules/sse-stream/public-infra-status.service';

@ApiTags('default')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly publicInfra: PublicInfraStatusService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiTags('health')
  @ApiOperation({
    summary: 'Health check',
    description:
      'État du process Node (mémoire, CPU cumulatif), ping MongoDB, indices d’exécution (cgroup mémoire, Cloud Run). HTTP 200 même en `degraded` si la base ne répond pas — utiliser le champ `status` pour l’alerting. Sans authentification.',
  })
  async getHealth() {
    return this.appService.getHealth();
  }

  @Get('health/infra')
  @ApiTags('health')
  @ApiOperation({
    summary: 'Statut infrastructure publique',
    description:
      'MongoDB, Redis, cartes, stockage fichiers, e-mail, SMS et WhatsApp — sans authentification.',
  })
  async getPublicInfraHealth() {
    return this.publicInfra.probeAll();
  }
}
