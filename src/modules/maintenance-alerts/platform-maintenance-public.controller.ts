import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformMaintenanceService } from './platform-maintenance.service';

@ApiTags('platform-maintenance')
@Controller('platform/maintenance-mode')
export class PlatformMaintenancePublicController {
  constructor(private readonly platformMaintenance: PlatformMaintenanceService) {}

  @Get()
  @ApiOperation({
    summary:
      'Statut mode maintenance par plateforme mobile (vendor, delivery, customer)',
  })
  getPublicStatus() {
    return this.platformMaintenance.getPublicStatus();
  }
}
