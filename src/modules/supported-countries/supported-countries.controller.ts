import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AdminSupportedCountriesUpdateDto } from './dto/admin-supported-countries.dto';
import {
  AdminRegionTaxesUpdateDto,
  RegionTaxEstimateQueryDto,
} from './dto/region-taxes.dto';
import {
  UpdateRegionAdDiffusionPricingDto,
  UpdateRegionAdNotificationPricingDto,
  UpdateRegionVendorSmsPricingDto,
} from './dto/region-pricing.dto';
import type { RegionTaxModule } from './region-tax.constants';
import { normalizeRegionTaxRules } from './region-tax.util';
import { RegionPricingService } from './region-pricing.service';
import { SupportedCountriesService } from './supported-countries.service';

@ApiTags('supported-countries')
@Controller('supported-countries')
export class SupportedCountriesController {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _regionPricing: RegionPricingService,
    private readonly _storeAccess: StoreAccessService,
  ) {}

  @Get()
  async list() {
    const countries = await this._supportedCountries.listActive();
    return { countries };
  }

  @Get('region-settings')
  async getPublicRegionSettings() {
    return this._supportedCountries.getPublicRegionSettings();
  }

  /** Estimation taxes (panier, abonnement, etc.) — pays actif requis, sinon 0 %. */
  @Get('taxes/estimate')
  async estimateTaxes(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: RegionTaxEstimateQueryDto,
  ) {
    const breakdown = await this._supportedCountries.computeTaxesForModule({
      countryCode: query.countryCode,
      baseAmount: query.amount,
      module: query.module as RegionTaxModule,
    });
    return breakdown;
  }

  @Get('admin/all')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async listForAdmin(@Req() req: Request) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    const countries = await this._supportedCountries.listAllForAdmin();
    return { countries };
  }

  @Put('admin/all')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveForAdmin(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminSupportedCountriesUpdateDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    await this._supportedCountries.saveAllForAdmin(body.countries ?? []);
    return { ok: true };
  }

  @Get('admin/:code/taxes')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getTaxesForAdmin(@Req() req: Request, @Param('code') code: string) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    const taxes =
      await this._supportedCountries.getTaxRulesForCountryAdmin(code);
    return { code: code.trim().toUpperCase(), taxes };
  }

  @Put('admin/:code/taxes')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveTaxesForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminRegionTaxesUpdateDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    const taxes = await this._supportedCountries.saveTaxRulesForCountry(
      code,
      normalizeRegionTaxRules(body.taxes ?? []),
    );
    return { code: code.trim().toUpperCase(), taxes };
  }

  @Get('admin/:code/ad-diffusion-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getAdDiffusionPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.getAdDiffusionPricing(code);
  }

  @Put('admin/:code/ad-diffusion-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveAdDiffusionPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateRegionAdDiffusionPricingDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.saveAdDiffusionPricing(code, body);
  }

  @Get('admin/:code/ad-notification-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getAdNotificationPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.getAdNotificationPricing(code);
  }

  @Put('admin/:code/ad-notification-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveAdNotificationPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateRegionAdNotificationPricingDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.saveAdNotificationPricing(code, body);
  }

  @Get('admin/:code/vendor-sms-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getVendorSmsPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.getVendorSmsPricing(code);
  }

  @Put('admin/:code/vendor-sms-pricing')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveVendorSmsPricingForAdmin(
    @Req() req: Request,
    @Param('code') code: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateRegionVendorSmsPricingDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    return this._regionPricing.saveVendorSmsPricing(code, body);
  }
}
