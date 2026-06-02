import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UpdateAdminOpsReportSettingsDto } from '@modules/admin-ops-reports/dto/update-admin-ops-report-settings.dto';
import { AdminOpsReportsService } from '@modules/admin-ops-reports/admin-ops-reports.service';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';

@ApiTags('Admin — Ops reports')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('db-maintenance/admin/ops-reports')
export class AdminOpsReportsAdminController {
  constructor(private readonly reports: AdminOpsReportsService) {}

  @Get('settings')
  @ApiOperation({
    summary:
      'Paramètres rapport vendeur (fréquence admin, envoi aux propriétaires)',
  })
  getSettings(@Req() req: Request) {
    return this.reports.getSettings(req.user as UserModel);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Met à jour les paramètres rapport ops' })
  updateSettings(
    @Req() req: Request,
    @Body() dto: UpdateAdminOpsReportSettingsDto,
  ) {
    return this.reports.updateSettings(req.user as UserModel, dto);
  }

  @Post('send-now')
  @ApiOperation({
    summary:
      'Envoie immédiatement le rapport à tous les propriétaires vendeurs éligibles',
  })
  sendNow(@Req() req: Request) {
    return this.reports.sendReportNow(req.user as UserModel);
  }
}
