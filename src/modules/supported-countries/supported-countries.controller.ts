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
import type { RegionTaxModule } from './region-tax.constants';
import { normalizeRegionTaxRules } from './region-tax.util';
import { SupportedCountriesService } from './supported-countries.service';

@ApiTags('supported-countries')
@Controller('supported-countries')
export class SupportedCountriesController {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _storeAccess: StoreAccessService,
  ) {}

  @Get()
  async list() {
    const countries = await this._supportedCountries.listActive();
    return { countries };
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
}
