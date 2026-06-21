import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateVendorNotificationPricingDto } from './dto/vendor-notification.dto';
import { VendorNotificationAdminService } from './vendor-notification-admin.service';
import { VendorNotificationBillingService } from './vendor-notification-billing.service';
import { VendorNotificationDispatchService } from './vendor-notification-dispatch.service';

@ApiTags('admin-vendor-notifications')
@ApiBearerAuth('bearer')
@Controller('admin/vendor-notifications')
@UseGuards(JwtGuard)
export class VendorNotificationAdminController {
  @Inject(VendorNotificationAdminService)
  private readonly adminStats: VendorNotificationAdminService;

  @Inject(VendorNotificationBillingService)
  private readonly billing: VendorNotificationBillingService;

  @Inject(VendorNotificationDispatchService)
  private readonly dispatch: VendorNotificationDispatchService;

  @Inject(StoreAccessService)
  private readonly storeAccess: StoreAccessService;

  private assertAdmin(user: UserModel): void {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  @Get('stats')
  async stats(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('billingMonth') billingMonth?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertAdmin(req.user as UserModel);
    return this.adminStats.platformStats({ storeId, billingMonth, from, to });
  }

  @Get('pricing')
  async getPricing(
    @Req() req: Request,
    @Query('countryCode') countryCode?: string,
  ) {
    this.assertAdmin(req.user as UserModel);
    return this.dispatch.getPricing(countryCode);
  }

  @Patch('pricing')
  async patchPricing(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateVendorNotificationPricingDto,
    @Query('countryCode') countryCode?: string,
  ) {
    this.assertAdmin(req.user as UserModel);
    return this.dispatch.updatePricing(body, countryCode);
  }

  @Get('monthly-charges')
  async monthlyCharges(
    @Req() req: Request,
    @Query('storeId') storeId?: string,
    @Query('billingMonth') billingMonth?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertAdmin(req.user as UserModel);
    return this.billing.listMonthlyCharges({
      storeId,
      billingMonth,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
