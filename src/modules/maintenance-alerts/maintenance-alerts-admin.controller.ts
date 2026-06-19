import { Body, Controller, Get, Patch, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateMaintenanceAlertSettingsDto } from './dto/update-maintenance-alert-settings.dto';
import { TogglePlatformMaintenanceDto } from './dto/toggle-platform-maintenance.dto';
import { MaintenanceAlertMonitorService } from './maintenance-alert-monitor.service';
import { MaintenanceAlertSettingsService } from './maintenance-alert-settings.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';

@ApiTags('Admin — Maintenance alerts')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('db-maintenance/admin/maintenance-alerts')
export class MaintenanceAlertsAdminController {
  constructor(
    private readonly settings: MaintenanceAlertSettingsService,
    private readonly monitor: MaintenanceAlertMonitorService,
    private readonly platformMaintenance: PlatformMaintenanceService,
  ) {}

  @Get('settings')
  @ApiOperation({
    summary:
      'Paramètres alertes infra (e-mail, SMS/WhatsApp/Telegram ops, moteur SMS)',
  })
  getSettings(@Req() req: Request) {
    return this.settings.getSettings(req.user as UserModel);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Met à jour les paramètres alertes maintenance' })
  updateSettings(
    @Req() req: Request,
    @Body() dto: UpdateMaintenanceAlertSettingsDto,
  ) {
    return this.settings.updateSettings(req.user as UserModel, dto);
  }

  @Post('probe-now')
  @ApiOperation({
    summary:
      'Force une passe de surveillance infra (envoi si incident détecté)',
  })
  async probeNow(@Req() req: Request) {
    await this.settings.getSettings(req.user as UserModel);
    await this.monitor.tick();
    return { ok: true as const };
  }

  @Get('platform-mode')
  @ApiOperation({ summary: 'Statut mode maintenance par plateforme (admin)' })
  getPlatformMode(@Req() req: Request) {
    return this.platformMaintenance.getAdminStatus(req.user as UserModel);
  }

  @Post('platform-mode/toggle')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Active/désactive le mode maintenance pour Vendor, Delivery ou Customer',
  })
  togglePlatformMode(
    @Req() req: Request,
    @Body() dto: TogglePlatformMaintenanceDto,
  ) {
    return this.platformMaintenance.toggle(req.user as UserModel, dto);
  }
}
