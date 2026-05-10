import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { StripeConnectOnboardingDto } from './dto/stripe-connect-onboarding.dto';
import { CreatePaymentMethodDto } from './paypal/dto/paypal.dto';
import { PaypalService } from './paypal/paypal.service';

@ApiTags('billing')
@ApiBearerAuth('bearer')
@Controller('billing')
export class BillingController {
  @Inject(PaypalService) private readonly _paypalService: PaypalService;
  @Inject(BillingService) private readonly _billingService: BillingService;

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
}
