import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { OfferPartnerSubscriptionDto } from './dto/partner-subscription-plan.dto';
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

  @Post('offer')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — offrir / assigner un abonnement Partner (e-mail + push)',
  })
  offer(
    @Req() req: Request,
    @Body() body: OfferPartnerSubscriptionDto,
  ) {
    return this.subscriptions.offerPartnerSubscriptionAdmin(
      req.user as UserModel,
      body,
    );
  }
}
