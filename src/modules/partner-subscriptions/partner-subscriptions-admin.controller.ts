import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { PartnerSubscriptionsService } from './partner-subscriptions.service';

@ApiTags('partner-subscriptions-admin')
@ApiBearerAuth('bearer')
@Controller('partner/admin/subscriptions')
export class PartnerSubscriptionsAdminController {
  @Inject(PartnerSubscriptionsService)
  private readonly subscriptions: PartnerSubscriptionsService;

  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — historique / liste des abonnements Partner',
  })
  list(@Req() req: Request) {
    return this.subscriptions.listSubscriptionsAdmin(req.user as UserModel);
  }
}
