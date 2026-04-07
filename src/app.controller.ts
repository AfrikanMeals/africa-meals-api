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
      'Vérifie que l’API répond (uptime, version). Sans authentification.',
  })
  getHealth() {
    return this.appService.getHealth();
  }
}
