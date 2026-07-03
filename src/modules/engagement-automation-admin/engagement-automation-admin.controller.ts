import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { EngagementAutomationAdminService } from './engagement-automation-admin.service';

@ApiTags('engagement-automation-admin')
@ApiBearerAuth('bearer')
@UseGuards(JwtGuard)
@Controller('admin/engagement/automation')
export class EngagementAutomationAdminController {
  constructor(private readonly service: EngagementAutomationAdminService) {}

  @Post('push-reco/classifier')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Lance manuellement le classifier push reco (admin plateforme, ignore cron enabled)',
  })
  runPushClassifier(@Req() req: Request) {
    return this.service.runPushClassifier(req.user as UserModel);
  }

  @Post('push-reco/planner')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Lance manuellement le planner push reco (admin plateforme, ignore cron enabled)',
  })
  runPushPlanner(@Req() req: Request) {
    return this.service.runPushPlanner(req.user as UserModel);
  }

  @Post('newsletter/classifier')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Lance manuellement le classifier newsletter (admin plateforme, ignore cron enabled)',
  })
  runNewsletterClassifier(@Req() req: Request) {
    return this.service.runNewsletterClassifier(req.user as UserModel);
  }

  @Post('newsletter/planner')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Lance manuellement le planner newsletter (admin plateforme, ignore cron enabled)',
  })
  runNewsletterPlanner(@Req() req: Request) {
    return this.service.runNewsletterPlanner(req.user as UserModel);
  }
}
