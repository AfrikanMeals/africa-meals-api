import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('default')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
}
