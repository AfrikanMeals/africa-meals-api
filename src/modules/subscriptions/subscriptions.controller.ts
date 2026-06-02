import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { ConfirmSubscriptionCheckoutDto } from './dto/confirm-subscription-checkout.dto';
import { SyncSubscriptionPaymentDto } from './dto/sync-subscription-payment.dto';
import {
  AdminOfferVendorSubscriptionDto,
  CreateSubscriptionPlanDto,
  SubscribeVendorDto,
  UpdateSubscriptionPlanDto,
} from './dto/subscription-plan.dto';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsStripeCheckoutService } from './subscriptions-stripe-checkout.service';

@ApiTags('subscriptions')
@ApiBearerAuth('bearer')
@Controller('subscriptions')
export class SubscriptionsController {
  @Inject(SubscriptionsService)
  private readonly subscriptions: SubscriptionsService;

  @Inject(SubscriptionsStripeCheckoutService)
  private readonly subscriptionStripe: SubscriptionsStripeCheckoutService;

  @Get('plans')
  @UseGuards(JwtGuard)
  listPlans(
    @Req() req: Request,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const all =
      includeInactive === '1' ||
      includeInactive === 'true' ||
      includeInactive === 'yes';
    return this.subscriptions.listPlans(req.user as UserModel, all);
  }

  @Post('plans')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createPlan(@Req() req: Request, @Body() body: CreateSubscriptionPlanDto) {
    return this.subscriptions.createPlan(req.user as UserModel, body);
  }

  @Patch('plans/:planId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updatePlan(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Body() body: UpdateSubscriptionPlanDto,
  ) {
    return this.subscriptions.updatePlan(req.user as UserModel, planId, body);
  }

  @Delete('plans/:planId')
  @UseGuards(JwtGuard)
  deactivatePlan(@Req() req: Request, @Param('planId') planId: string) {
    return this.subscriptions.deletePlan(req.user as UserModel, planId);
  }

  @Delete('plans/:planId/permanent')
  @UseGuards(JwtGuard)
  permanentlyDeletePlan(@Req() req: Request, @Param('planId') planId: string) {
    return this.subscriptions.permanentlyDeletePlan(
      req.user as UserModel,
      planId,
    );
  }

  @Get('vendor-subscriptions')
  @UseGuards(JwtGuard)
  listVendorSubscriptions(@Req() req: Request) {
    return this.subscriptions.listVendorSubscriptionsAdmin(
      req.user as UserModel,
    );
  }

  @Post('vendor-subscriptions/offer')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  offerVendorSubscription(
    @Req() req: Request,
    @Body() body: AdminOfferVendorSubscriptionDto,
  ) {
    return this.subscriptions.offerVendorSubscriptionAdmin(
      req.user as UserModel,
      body,
    );
  }

  @Patch('vendor-subscriptions/:subscriptionId/deactivate')
  @UseGuards(JwtGuard)
  deactivateVendorSubscription(
    @Req() req: Request,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptions.deactivateVendorSubscriptionAdmin(
      req.user as UserModel,
      subscriptionId,
    );
  }

  @Delete('vendor-subscriptions/:subscriptionId')
  @UseGuards(JwtGuard)
  deleteVendorSubscription(
    @Req() req: Request,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptions.deleteVendorSubscriptionAdmin(
      req.user as UserModel,
      subscriptionId,
    );
  }

  @Get('my')
  @UseGuards(JwtGuard)
  mySubscriptions(@Req() req: Request) {
    return this.subscriptions.getMySubscriptions(req.user as UserModel);
  }

  /** PaymentIntent pour Payment Sheet (montant plan, sans frais plateforme). */
  @Post('payment-intent')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createPaymentIntent(@Req() req: Request, @Body() body: SubscribeVendorDto) {
    return this.subscriptionStripe.createPaymentIntent(
      req.user as UserModel,
      body,
    );
  }

  /** Active l’abonnement après Payment Sheet (idempotent, complète le webhook). */
  @Post('payment-intent/sync')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  syncPaymentIntent(
    @Req() req: Request,
    @Body() body: SyncSubscriptionPaymentDto,
  ) {
    return this.subscriptionStripe.syncPaymentIntentForUser(
      req.user as UserModel,
      body.paymentIntentId,
    );
  }

  /** Checkout hébergé (secours navigateur). */
  @Post('trial')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  startTrial(@Req() req: Request, @Body() body: SubscribeVendorDto) {
    return this.subscriptions.startVendorTrial(req.user as UserModel, body);
  }

  @Post('checkout-session')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createCheckoutSession(@Req() req: Request, @Body() body: SubscribeVendorDto) {
    return this.subscriptionStripe.createCheckoutSession(
      req.user as UserModel,
      body,
    );
  }

  /** Confirme l’abonnement après retour Checkout (idempotent, complète le webhook). */
  @Post('confirm-checkout')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  confirmCheckout(
    @Req() req: Request,
    @Body() body: ConfirmSubscriptionCheckoutDto,
  ) {
    return this.subscriptionStripe.confirmCheckoutForUser(
      req.user as UserModel,
      body.sessionId,
    );
  }
}
