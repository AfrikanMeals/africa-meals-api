import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { PartnerPaymentsService } from './partner-payments.service';

/**
 * Paiements Stripe Connect partenaire (miroir delivery-agent/payments).
 */
@ApiTags('partner-payments')
@ApiBearerAuth('bearer')
@Controller('partner/payments')
export class PartnerPaymentsController {
  @Inject(PartnerPaymentsService)
  private readonly _payments: PartnerPaymentsService;

  @Get('connect-status')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Statut Stripe Connect du partenaire.' })
  connectStatus(@Req() req: Request) {
    return this._payments.getConnectStatus(req.user as UserModel);
  }

  @Post('onboarding-link')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lien d’onboarding Stripe Connect (partenaire).' })
  onboardingLink(@Req() req: Request) {
    return this._payments.createOnboardingLink(req.user as UserModel);
  }

  @Get('balance')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Solde Stripe Connect (partenaire).' })
  balance(@Req() req: Request) {
    return this._payments.getConnectBalance(req.user as UserModel);
  }

  @Get('payout-estimate')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Estimate versement Stripe Connect (partenaire).' })
  payoutEstimate(@Req() req: Request) {
    return this._payments.getPayoutEstimate(req.user as UserModel);
  }

  @Post('request-payout')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Demander un versement bancaire (partenaire).' })
  requestPayout(@Req() req: Request) {
    return this._payments.requestPayout(req.user as UserModel);
  }

  @Get('payouts')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Historique des versements Stripe (partenaire).' })
  payouts(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('starting_after') startingAfter?: string,
  ) {
    const n = limit != null ? Number(limit) : 25;
    return this._payments.listPayouts(
      req.user as UserModel,
      n,
      startingAfter,
    );
  }

  @Get('earnings')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Commissions d’affiliation du partenaire (ledger).',
  })
  earnings(@Req() req: Request) {
    return this._payments.listEarnings(req.user as UserModel);
  }
}
