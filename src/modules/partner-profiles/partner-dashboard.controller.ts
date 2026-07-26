import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { PartnerDashboardService } from './partner-dashboard.service';

@ApiTags('partner-dashboard')
@ApiBearerAuth('bearer')
@Controller('partner')
export class PartnerDashboardController {
  @Inject(PartnerDashboardService)
  private readonly dashboard: PartnerDashboardService;

  @Get('dashboard')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Dashboard Partner — KPI commissions, référents, abonnement, activité',
  })
  getDashboard(@Req() req: Request) {
    return this.dashboard.getDashboard(req.user as UserModel);
  }
}
