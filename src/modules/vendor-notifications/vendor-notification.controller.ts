import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateVendorNotificationPreferencesDto } from './dto/vendor-notification.dto';
import { VendorNotificationPreferencesService } from './vendor-notification-preferences.service';
import { VendorNotificationBillingService } from './vendor-notification-billing.service';
import { VendorNotificationDispatchService } from './vendor-notification-dispatch.service';
import { VendorNotificationStripeBillingService } from './vendor-notification-stripe-billing.service';

@ApiTags('vendor-notifications')
@ApiBearerAuth('bearer')
@Controller('stores')
export class VendorNotificationController {
  @Inject(VendorNotificationPreferencesService)
  private readonly prefs: VendorNotificationPreferencesService;

  @Inject(VendorNotificationBillingService)
  private readonly billing: VendorNotificationBillingService;

  @Inject(VendorNotificationDispatchService)
  private readonly dispatch: VendorNotificationDispatchService;

  @Inject(VendorNotificationStripeBillingService)
  private readonly stripeBilling: VendorNotificationStripeBillingService;

  @Post('notification-sms-billing/confirm-checkout')
  @UseGuards(JwtGuard)
  confirmSmsBillingCheckout(
    @Req() req: Request,
    @Body('sessionId') sessionId: string,
  ) {
    const user = req.user as UserModel;
    return this.stripeBilling.confirmCheckoutSession(
      String(user.id ?? user._id),
      sessionId,
    );
  }

  /** Payment Sheet mobile — PaymentIntent facture SMS. */
  @Post(':storeId/notification-sms-billing/payment-intent')
  @UseGuards(JwtGuard)
  async createSmsBillingPaymentIntent(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body('billingMonth') billingMonth?: string,
  ) {
    const user = req.user as UserModel;
    await this.prefs.getForStoreAsVendor(user, storeId);
    return this.stripeBilling.createPaymentIntentForStore(
      storeId,
      String(user.id ?? user._id),
      billingMonth,
    );
  }

  /** Sync après Payment Sheet SMS réussie. */
  @Post('notification-sms-billing/payment-intent/sync')
  @UseGuards(JwtGuard)
  syncSmsBillingPaymentIntent(
    @Req() req: Request,
    @Body('paymentIntentId') paymentIntentId: string,
  ) {
    const user = req.user as UserModel;
    return this.stripeBilling.syncPaymentIntent(
      String(user.id ?? user._id),
      paymentIntentId,
    );
  }

  @Get(':storeId/notification-preferences')
  @UseGuards(JwtGuard)
  async getPreferences(
    @Req() req: Request,
    @Param('storeId') storeId: string,
  ) {
    await this.prefs.syncOverdueSmsBillingForStore(storeId);
    return this.prefs.getForStoreAsVendor(req.user as UserModel, storeId);
  }

  @Patch(':storeId/notification-preferences')
  @UseGuards(JwtGuard)
  patchPreferences(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateVendorNotificationPreferencesDto,
  ) {
    return this.prefs.updateForStoreAsVendor(
      req.user as UserModel,
      storeId,
      body,
    );
  }

  @Get(':storeId/notification-sms-billing/pay-link')
  @UseGuards(JwtGuard)
  async smsBillingPayLink(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Query('billingMonth') billingMonth?: string,
    @Query('client') client?: string,
  ) {
    await this.prefs.getForStoreAsVendor(req.user as UserModel, storeId);
    // client=mobile → success_url pont wise-eat://kind=sms_billing
    return this.stripeBilling.getPayLinkForStore(storeId, billingMonth, {
      client,
    });
  }

  @Get(':storeId/notification-sms-history')
  @UseGuards(JwtGuard)
  async smsHistory(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Query('billingMonth') billingMonth?: string,
    @Query('limit') limit?: string,
  ) {
    await this.prefs.getForStoreAsVendor(req.user as UserModel, storeId);
    const pricing = await this.dispatch.getPricingForStore(storeId);
    const billingSummary =
      await this.billing.getVendorSmsBillingSummary(storeId);
    const history = await this.billing.vendorSmsHistory({
      storeId,
      billingMonth,
      limit: limit ? Number(limit) : undefined,
    });
    const charges = await this.billing.listMonthlyCharges({
      storeId,
      billingMonth,
      limit: 12,
    });
    return { pricing, history, charges, billingSummary };
  }
}
