import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BusinessReportsService } from './business-reports.service';

@ApiTags('business-reports')
@ApiBearerAuth('bearer')
@Controller('business-reports')
export class BusinessReportsAdminController {
  @Inject(BusinessReportsService)
  private readonly _businessReports: BusinessReportsService;

  @Get('admin/by-store')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Liste des signalements boutiques groupés par restaurant (compte ADMIN uniquement)',
  })
  async listGroupedByStore(@Req() req: Request) {
    return this._businessReports.listGroupedByStoreForAdmin(
      req.user as UserModel,
    );
  }
}
