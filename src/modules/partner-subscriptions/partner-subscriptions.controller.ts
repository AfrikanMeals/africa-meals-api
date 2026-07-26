import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  AttachPartnerReferralDto,
  StartPartnerTrialDto,
  SubscribePartnerDto,
  SyncPartnerPaymentDto,
} from './dto/partner-subscription-plan.dto';
import { PartnerAffiliationEarningsService } from './partner-affiliation-earnings.service';
import { PartnerSubscriptionPlansService } from './partner-subscription-plans.service';
import { PartnerSubscriptionsService } from './partner-subscriptions.service';

@ApiTags('partner-subscriptions')
@ApiBearerAuth('bearer')
@Controller('partner/subscriptions')
export class PartnerSubscriptionsController {
  @Inject(PartnerSubscriptionPlansService)
  private readonly plans: PartnerSubscriptionPlansService;

  @Inject(PartnerSubscriptionsService)
  private readonly subscriptions: PartnerSubscriptionsService;

  @Inject(PartnerAffiliationEarningsService)
  private readonly affiliation: PartnerAffiliationEarningsService;

  @Get('plans')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Catalogue formules Partner actives' })
  listPlans(@Req() req: Request, @Query('region') region?: string) {
    return this.plans.listActivePlansForPartner(
      req.user as UserModel,
      region?.trim() || null,
    );
  }

  @Get('mine')
  @UseGuards(JwtGuard)
  mine(@Req() req: Request) {
    return this.subscriptions.getMine(req.user as UserModel);
  }

  @Post('start-trial')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  startTrial(@Req() req: Request, @Body() body: StartPartnerTrialDto) {
    return this.subscriptions.startTrial(req.user as UserModel, body);
  }

  @Post('activate-free')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Activer le plan FREE Partner (défaut, sans Stripe)',
  })
  activateFree(
    @Req() req: Request,
    @Body() body: { planId?: string },
  ) {
    return this.subscriptions.activateFreePlan(
      req.user as UserModel,
      body?.planId,
    );
  }

  /** PaymentIntent + Payment Sheet (mobile recommandé). */
  @Post('payment-intent')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'PaymentIntent abonnement Partner (Payment Sheet)' })
  createPaymentIntent(
    @Req() req: Request,
    @Body() body: SubscribePartnerDto,
  ) {
    return this.subscriptions.createPaymentIntent(
      req.user as UserModel,
      body,
    );
  }

  @Post('payment-intent/sync')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Activer abonnement après Payment Sheet' })
  syncPaymentIntent(
    @Req() req: Request,
    @Body() body: SyncPartnerPaymentDto,
  ) {
    return this.subscriptions.syncPaymentIntentForUser(
      req.user as UserModel,
      body.paymentIntentId,
    );
  }

  /** Checkout hébergé (admin web / secours navigateur). */
  @Post('checkout')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  checkout(@Req() req: Request, @Body() body: SubscribePartnerDto) {
    return this.subscriptions.createCheckoutSession(
      req.user as UserModel,
      body,
    );
  }

  @Post('confirm')
  @UseGuards(JwtGuard)
  confirm(
    @Req() req: Request,
    @Body() body: { sessionId?: string },
  ) {
    return this.subscriptions.confirmCheckout(
      req.user as UserModel,
      String(body?.sessionId ?? ''),
    );
  }

  @Get('referral/lookup')
  @ApiOperation({
    summary: 'Valider un code referral Partner (public, sans identité)',
  })
  lookupReferral(@Query('code') code?: string) {
    return this.affiliation.lookupPublicReferralCode(code);
  }

  @Post('referral/attach')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Attacher un code referral Partner au compte' })
  attachReferral(
    @Req() req: Request,
    @Body() body: AttachPartnerReferralDto,
  ) {
    return this.affiliation.attachReferral(req.user as UserModel, body);
  }
}
