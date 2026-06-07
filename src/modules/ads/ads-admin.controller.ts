import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdModerationStatusEnum } from '@schemas/ad.schema';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { RejectAdModerationDto } from './dto/ad-moderation.dto';
import { AdsAdminService } from './ads-admin.service';
import { AdsService } from './ads.service';

@ApiTags('ads-admin')
@ApiBearerAuth('bearer')
@Controller('ads/admin')
@UseGuards(JwtGuard)
export class AdsAdminController {
  constructor(
    private readonly adsAdmin: AdsAdminService,
    private readonly adsService: AdsService,
  ) {}

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

  @Get('events/recent')
  recentEvents(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adsAdmin.getRecentEvents(req.user as UserModel, {
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('moderation')
  moderationQueue(
    @Req() req: Request,
    @Query('status') status?: string,
  ) {
    const normalized = status?.trim().toUpperCase();
    const parsed =
      normalized === 'ALL'
        ? ('ALL' as const)
        : normalized &&
            Object.values(AdModerationStatusEnum).includes(
              normalized as AdModerationStatusEnum,
            )
          ? (normalized as AdModerationStatusEnum)
          : undefined;
    return this.adsService.listModerationQueue(
      req.user as UserModel,
      parsed,
    );
  }

  @Post('moderation/banners/:id/approve')
  approveBannerModeration(@Req() req: Request, @Param('id') id: string) {
    return this.adsService.approveBannerModeration(req.user as UserModel, id);
  }

  @Post('moderation/banners/:id/reject')
  rejectBannerModeration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RejectAdModerationDto,
  ) {
    return this.adsService.rejectBannerModeration(
      req.user as UserModel,
      id,
      body.rejectionReason,
    );
  }

  @Post('moderation/campaigns/:id/approve')
  approveCampaignModeration(@Req() req: Request, @Param('id') id: string) {
    return this.adsService.approveCampaignModeration(req.user as UserModel, id);
  }

  @Post('moderation/campaigns/:id/reject')
  rejectCampaignModeration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RejectAdModerationDto,
  ) {
    return this.adsService.rejectCampaignModeration(
      req.user as UserModel,
      id,
      body.rejectionReason,
    );
  }

  @Post('moderation/banners/:id/block')
  blockBannerModeration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RejectAdModerationDto,
  ) {
    return this.adsService.blockBannerModeration(
      req.user as UserModel,
      id,
      body.rejectionReason,
    );
  }

  @Post('moderation/campaigns/:id/block')
  blockCampaignModeration(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RejectAdModerationDto,
  ) {
    return this.adsService.blockCampaignModeration(
      req.user as UserModel,
      id,
      body.rejectionReason,
    );
  }
}
