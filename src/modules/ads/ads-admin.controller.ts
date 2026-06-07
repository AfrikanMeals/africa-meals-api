import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AdsAdminService } from './ads-admin.service';

@ApiTags('ads-admin')
@ApiBearerAuth('bearer')
@Controller('ads/admin')
@UseGuards(JwtGuard)
export class AdsAdminController {
  constructor(private readonly adsAdmin: AdsAdminService) {}

  @Get('overview')
  overview(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adsAdmin.getOverview(req.user as UserModel, { from, to });
  }

  @Get('timeseries')
  timeseries(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adsAdmin.getTimeseries(req.user as UserModel, { from, to });
  }

  @Get('entities')
  entities(
    @Req() req: Request,
    @Query('kind') kind?: 'BANNER' | 'CAMPAIGN' | 'ALL',
    @Query('status') status?: 'ACTIVE' | 'ARCHIVED' | 'ALL',
    @Query('sort') sort?: 'spend' | 'impressions' | 'clicks' | 'conversions',
    @Query('limit') limit?: string,
  ) {
    return this.adsAdmin.getEntities(req.user as UserModel, {
      kind,
      status,
      sort,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('vendors')
  vendors(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adsAdmin.getVendors(req.user as UserModel, { from, to });
  }

  @Get('notifications')
  notifications(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adsAdmin.getNotifications(req.user as UserModel, { from, to });
  }
}
