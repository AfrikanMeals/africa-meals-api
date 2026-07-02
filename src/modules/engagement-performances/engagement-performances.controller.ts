import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { QueryEngagementPerformancesDto } from './dto/query-engagement-performances.dto';
import { EngagementPerformancesService } from './engagement-performances.service';

@ApiTags('engagement-performances')
@ApiBearerAuth('bearer')
@Controller('admin/engagement/performances')
@UseGuards(JwtGuard)
export class EngagementPerformancesController {
  constructor(private readonly service: EngagementPerformancesService) {}

  @Get('overview')
  overview(@Req() req: Request, @Query() query: QueryEngagementPerformancesDto) {
    return this.service.getOverview(req.user as UserModel, query);
  }

  @Get('push-reco')
  pushReco(@Req() req: Request, @Query() query: QueryEngagementPerformancesDto) {
    return this.service.getPushRecoDetail(req.user as UserModel, query);
  }

  @Get('newsletter')
  newsletter(@Req() req: Request, @Query() query: QueryEngagementPerformancesDto) {
    return this.service.getNewsletterDetail(req.user as UserModel, query);
  }
}
