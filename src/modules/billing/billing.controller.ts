import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Query,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Headers,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { StripeConnectOnboardingDto } from './dto/stripe-connect-onboarding.dto';
import { CreatePaymentMethodDto } from './paypal/dto/paypal.dto';
import { PaypalService } from './paypal/paypal.service';
import { FilterGroupedPaymentsDto } from './stripe/dto/filter-grouped-payments.dto';
import { GroupedStripeCheckoutDto } from './stripe/dto/grouped-stripe-checkout.dto';
import { GroupedPaymentSyncDto } from './stripe/dto/grouped-payment-sync.dto';
import { StripeConnectOnboardingDto } from './stripe/dto/stripe-connect-onboarding.dto';
import { StripeConnectService } from './stripe/stripe-connect.service';
import { StripeGroupedCheckoutService } from './stripe/stripe-grouped-checkout.service';

@ApiTags('billing')
@ApiBearerAuth('bearer')
@Controller('billing')
export class BillingController {
  @Inject(PaypalService) private readonly _paypalService: PaypalService;
  @Inject(BillingService) private readonly _billingService: BillingService;
  @Inject(StripeGroupedCheckoutService)
  private readonly _stripeGroupedCheckout: StripeGroupedCheckoutService;
  @Inject(StripeConnectService)
  private readonly _stripeConnect: StripeConnectService;

  @Post('create-paypal-vault-token')
  @UseGuards(JwtGuard)
  async createPaypalVaultToken(
    @Req() req: Request,
    @Body(ValidationPipe) body: CreatePaymentMethodDto,
  ) {
    return await this._paypalService.createSetupToken(
      body,
      req.user as UserModel,
    );
  }

  @Post('create-paypal-payment-token/:setUpId')
  @UseGuards(JwtGuard)
  async savePaymentToken(
    @Param('setUpId') setUpId: string,
    @Req() req: Request,
  ) {
    return await this._billingService.savePaypalPaymentMethod(
      setUpId,
      req.user as UserModel,
    );
  }

  @Delete('payment-method/:id')
  @UseGuards(JwtGuard)
  async deletePaymentToken(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this._billingService.deletePaypalPaymentMethod(
      id,
      req.user as UserModel,
    );
  }

  /** Balance transactions Stripe du compte Connect du restaurant (vendeur). */
  @Get('stripe/balance-transactions')
  @UseGuards(JwtGuard)
  async listStripeBalanceTransactions(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('limit') limitRaw?: string,
    @Query('startingAfter') startingAfter?: string,
  ) {
    const limit =
      limitRaw !== undefined && limitRaw !== ''
        ? Number.parseInt(limitRaw, 10)
        : undefined;
    return this._billingService.listStripeBalanceTransactionsForVendor(
      req.user as UserModel,
      {
        storeId: storeId?.trim() || undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        startingAfter: startingAfter?.trim() || undefined,
      },
    );
  }

  /** Lien d’onboarding Stripe Connect (compte Express + Account Link). */
  @Post('stripe/connect-onboarding')
  @UseGuards(JwtGuard)
  async stripeConnectOnboarding(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: StripeConnectOnboardingDto,
  ) {
    return this._billingService.startStripeConnectOnboarding(
      req.user as UserModel,
      { storeId: body.storeId },
    );
  }

  @Post('stripe/grouped-checkout-session')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Session Stripe Checkout (panier multi-boutiques : une ligne par restaurant)',
  })
  async stripeGroupedCheckoutSession(
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    dto: GroupedStripeCheckoutDto,
  ) {
    return this._stripeGroupedCheckout.createGroupedCheckoutSession(
      req.user as UserModel,
      dto,
    );
  }

  @Post('stripe/grouped-payment-intent')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'PaymentIntent (client_secret) pour Payment Sheet — Apple Pay, Google Pay, cartes',
  })
  async stripeGroupedPaymentIntent(
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    )
    dto: GroupedStripeCheckoutDto,
  ) {
    return this._stripeGroupedCheckout.createGroupedPaymentIntent(
      req.user as UserModel,
      dto,
    );
  }

  /** Confirme côté serveur un PaymentIntent réussi (complète le webhook si absent — ex. dev local). */
  @Post('stripe/grouped-payment-sync')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Synchronise les commandes après Payment Sheet (idempotent, même logique que le webhook)',
  })
  async stripeGroupedPaymentSync(
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: GroupedPaymentSyncDto,
  ) {
    return this._stripeGroupedCheckout.fulfillGroupedPaymentFromClient(
      req.user as UserModel,
      body.paymentIntentId,
    );
  }

  @Get('stripe/connect/status')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Statut Stripe Connect (vendeur)' })
  stripeConnectStatus(@Req() req: Request) {
    return this._stripeConnect.getConnectStatus(req.user as UserModel);
  }

  @Post('stripe/connect/onboarding-link')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Lien d’onboarding Stripe Connect (Setup Payment) avec préremplissage',
  })
  stripeConnectOnboarding(
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: StripeConnectOnboardingDto,
  ) {
    return this._stripeConnect.createOnboardingLink(req.user as UserModel);
  }

  @Post('stripe/connect/dashboard-link')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lien tableau de bord Stripe Express (vendeur)' })
  stripeConnectDashboard(@Req() req: Request) {
    return this._stripeConnect.createDashboardLink(req.user as UserModel);
  }

  @Get('stripe/connect/payouts')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Liste des versements Stripe Connect (vendeur)' })
  stripeConnectPayouts(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null ? Number(limit) : 25;
    return this._stripeConnect.listPayouts(req.user as UserModel, n);
  }

  @Get('stripe/connect/balance')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Solde disponible Stripe Connect (vendeur)' })
  stripeConnectBalance(@Req() req: Request) {
    return this._stripeConnect.getConnectBalance(req.user as UserModel);
  }

  @Post('stripe/connect/request-payout')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Demander un versement du solde disponible vers le compte bancaire',
  })
  stripeConnectRequestPayout(@Req() req: Request) {
    return this._stripeConnect.requestPayout(req.user as UserModel);
  }

  @Get('stripe/my-grouped-payments')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Historique des paiements panier multi-boutiques (Stripe Checkout ou Payment Sheet)',
  })
  async stripeMyGroupedPayments(
    @Req() req: Request,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: FilterGroupedPaymentsDto,
  ) {
    return this._stripeGroupedCheckout.listMyGroupedPayments(
      req.user as UserModel,
      query,
    );
  }

  /** Stripe envoie le corps brut JSON — utiliser `req.rawBody` (voir `main.ts`). */
  @Post('stripe/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Stripe (signature Stripe-Signature)' })
  async stripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') sig?: string,
  ) {
    return this._stripeGroupedCheckout.handleWebhook(sig, req.rawBody);
  }

  @Get('stripe/payment-done')
  @Header('Content-Type', 'text/html; charset=utf-8')
  stripePaymentDonePage(): string {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5"><p><strong>Paiement enregistré.</strong></p><p>Vous pouvez fermer cette page et retourner dans l’application Afrika Meals.</p></body></html>`;
  }

  @Get('stripe/payment-cancel')
  @Header('Content-Type', 'text/html; charset=utf-8')
  stripePaymentCancelPage(): string {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5"><p><strong>Paiement annulé.</strong></p><p>Vous pouvez fermer cette page.</p></body></html>`;
  }
}
