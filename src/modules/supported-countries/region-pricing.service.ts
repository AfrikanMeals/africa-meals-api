import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AdNotificationPricingSettingsModel,
} from '@schemas/ad-notification-pricing-settings.schema';
import { AdPricingSettingsModel } from '@schemas/ad-pricing-settings.schema';
import {
  SupportedCountryModel,
} from '@schemas/supported-country.schema';
import {
  VendorNotificationPricingSettingsModel,
} from '@schemas/vendor-notification-pricing-settings.schema';
import { Model } from 'mongoose';
import {
  UpdateRegionAdDiffusionPricingDto,
  UpdateRegionAdNotificationPricingDto,
  UpdateRegionVendorSmsPricingDto,
} from './dto/region-pricing.dto';
import {
  globalAdDiffusionFromDoc,
  globalAdNotificationFromDoc,
  globalVendorSmsFromDoc,
  mergeAdDiffusionPricing,
  mergeAdNotificationPricing,
  mergeVendorSmsPricing,
  normalizeRegionCode,
  toRegionAdDiffusionDoc,
  toRegionAdNotificationDoc,
  toRegionVendorSmsDoc,
  type RegionAdDiffusionPricingPayload,
  type RegionAdNotificationPricingPayload,
  type RegionVendorSmsPricingPayload,
} from './region-pricing.util';

const GLOBAL_KEY = 'default';

@Injectable()
export class RegionPricingService {
  constructor(
    @InjectModel(SupportedCountryModel.name)
    private readonly countryModel: Model<SupportedCountryModel>,
    @InjectModel(AdPricingSettingsModel.name)
    private readonly adPricingModel: Model<AdPricingSettingsModel>,
    @InjectModel(AdNotificationPricingSettingsModel.name)
    private readonly adNotificationPricingModel: Model<AdNotificationPricingSettingsModel>,
    @InjectModel(VendorNotificationPricingSettingsModel.name)
    private readonly vendorSmsPricingModel: Model<VendorNotificationPricingSettingsModel>,
  ) {}

  async resolveRegionCode(
    countryCode?: string | null,
  ): Promise<string> {
    const explicit = normalizeRegionCode(countryCode);
    if (explicit) return explicit;
    const primary = await this.countryModel
      .findOne({ active: true, code: 'CA' })
      .lean()
      .exec();
    if (primary?.code) return String(primary.code).toUpperCase();
    const first = await this.countryModel
      .findOne({ active: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    return String(first?.code ?? 'CA').toUpperCase();
  }

  private async loadCountry(code: string) {
    const doc = await this.countryModel.findOne({ code }).lean().exec();
    if (!doc) {
      throw new BadRequestException('country_not_found');
    }
    return doc;
  }

  private async loadGlobalAdDiffusion() {
    return this.adPricingModel.findOne({ key: GLOBAL_KEY }).lean().exec();
  }

  private async loadGlobalAdNotification() {
    return this.adNotificationPricingModel.findOne({ key: GLOBAL_KEY }).lean().exec();
  }

  private async loadGlobalVendorSms() {
    return this.vendorSmsPricingModel.findOne({ key: GLOBAL_KEY }).lean().exec();
  }

  async getAdDiffusionPricing(
    countryCode: string,
  ): Promise<RegionAdDiffusionPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const [country, globalDoc] = await Promise.all([
      this.loadCountry(code),
      this.loadGlobalAdDiffusion(),
    ]);
    const currency = String(country.currency ?? 'CAD').toUpperCase();
    const global = globalAdDiffusionFromDoc(globalDoc, currency);
    return mergeAdDiffusionPricing(
      code,
      currency,
      global,
      country.adDiffusionPricing,
    );
  }

  async saveAdDiffusionPricing(
    countryCode: string,
    dto: UpdateRegionAdDiffusionPricingDto,
  ): Promise<RegionAdDiffusionPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const current = await this.getAdDiffusionPricing(code);
    const next: RegionAdDiffusionPricingPayload = {
      ...current,
      cpmCad: dto.cpmCad ?? current.cpmCad,
      cpcCad: dto.cpcCad ?? current.cpcCad,
      campaignCpmCad: dto.campaignCpmCad ?? current.campaignCpmCad,
      campaignCpcCad: dto.campaignCpcCad ?? current.campaignCpcCad,
      campaignActionCad: dto.campaignActionCad ?? current.campaignActionCad,
      conversionCad: dto.conversionCad ?? current.conversionCad,
      minimumBudgetCad: dto.minimumBudgetCad ?? current.minimumBudgetCad,
      configuredOnRegion: true,
    };
    await this.countryModel
      .updateOne(
        { code },
        { $set: { adDiffusionPricing: toRegionAdDiffusionDoc(next) } },
      )
      .exec();
    return this.getAdDiffusionPricing(code);
  }

  async getAdNotificationPricing(
    countryCode: string,
  ): Promise<RegionAdNotificationPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const [country, globalDoc] = await Promise.all([
      this.loadCountry(code),
      this.loadGlobalAdNotification(),
    ]);
    const currency = String(country.currency ?? 'CAD').toUpperCase();
    const global = globalAdNotificationFromDoc(globalDoc, currency);
    return mergeAdNotificationPricing(
      code,
      currency,
      global,
      country.adNotificationPricing,
    );
  }

  async saveAdNotificationPricing(
    countryCode: string,
    dto: UpdateRegionAdNotificationPricingDto,
  ): Promise<RegionAdNotificationPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const current = await this.getAdNotificationPricing(code);
    const availDto = dto.availableChannels;
    const nextAvailable = availDto
      ? {
          email: availDto.email ?? current.availableChannels.email,
          push: availDto.push ?? current.availableChannels.push,
          inApp: availDto.inApp ?? current.availableChannels.inApp,
          sms: availDto.sms ?? current.availableChannels.sms,
          whatsapp: availDto.whatsapp ?? current.availableChannels.whatsapp,
        }
      : current.availableChannels;
    const next: RegionAdNotificationPricingPayload = {
      ...current,
      availableChannels: nextAvailable,
      emailDeliveryCad: dto.emailDeliveryCad ?? current.emailDeliveryCad,
      emailInteractionCad:
        dto.emailInteractionCad ?? current.emailInteractionCad,
      emailConversionCad: dto.emailConversionCad ?? current.emailConversionCad,
      pushDeliveryCad: dto.pushDeliveryCad ?? current.pushDeliveryCad,
      pushInteractionCad: dto.pushInteractionCad ?? current.pushInteractionCad,
      pushConversionCad: dto.pushConversionCad ?? current.pushConversionCad,
      inAppDeliveryCad: dto.inAppDeliveryCad ?? current.inAppDeliveryCad,
      inAppInteractionCad:
        dto.inAppInteractionCad ?? current.inAppInteractionCad,
      inAppConversionCad: dto.inAppConversionCad ?? current.inAppConversionCad,
      smsDeliveryCad: dto.smsDeliveryCad ?? current.smsDeliveryCad,
      smsInteractionCad: dto.smsInteractionCad ?? current.smsInteractionCad,
      smsConversionCad: dto.smsConversionCad ?? current.smsConversionCad,
      whatsappDeliveryCad: dto.whatsappDeliveryCad ?? current.whatsappDeliveryCad,
      whatsappInteractionCad:
        dto.whatsappInteractionCad ?? current.whatsappInteractionCad,
      whatsappConversionCad:
        dto.whatsappConversionCad ?? current.whatsappConversionCad,
      configuredOnRegion: true,
    };
    await this.countryModel
      .updateOne(
        { code },
        { $set: { adNotificationPricing: toRegionAdNotificationDoc(next) } },
      )
      .exec();
    return this.getAdNotificationPricing(code);
  }

  async getVendorSmsPricing(
    countryCode: string,
  ): Promise<RegionVendorSmsPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const [country, globalDoc] = await Promise.all([
      this.loadCountry(code),
      this.loadGlobalVendorSms(),
    ]);
    const currency = String(country.currency ?? 'CAD').toUpperCase();
    const global = globalVendorSmsFromDoc(globalDoc, currency);
    return mergeVendorSmsPricing(
      code,
      currency,
      global,
      country.vendorSmsPricing,
    );
  }

  async saveVendorSmsPricing(
    countryCode: string,
    dto: UpdateRegionVendorSmsPricingDto,
  ): Promise<RegionVendorSmsPricingPayload> {
    const code = normalizeRegionCode(countryCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const current = await this.getVendorSmsPricing(code);
    const next: RegionVendorSmsPricingPayload = {
      ...current,
      smsUnitCostCad: dto.smsUnitCostCad ?? current.smsUnitCostCad,
      smsEnabled: dto.smsEnabled ?? current.smsEnabled,
      billingCyclePeriod: dto.billingCyclePeriod ?? current.billingCyclePeriod,
      configuredOnRegion: true,
    };
    await this.countryModel
      .updateOne(
        { code },
        { $set: { vendorSmsPricing: toRegionVendorSmsDoc(next) } },
      )
      .exec();
    return this.getVendorSmsPricing(code);
  }

  /** Payload compatible legacy ads.service notification pricing. */
  async getLegacyAdNotificationPricingPayload(countryCode?: string | null) {
    const resolved = await this.getAdNotificationPricing(
      await this.resolveRegionCode(countryCode),
    );
    return {
      currency: resolved.currency,
      availableChannels: resolved.availableChannels,
      emailDeliveryCad: resolved.emailDeliveryCad,
      emailInteractionCad: resolved.emailInteractionCad,
      emailConversionCad: resolved.emailConversionCad,
      pushDeliveryCad: resolved.pushDeliveryCad,
      pushInteractionCad: resolved.pushInteractionCad,
      pushConversionCad: resolved.pushConversionCad,
      inAppDeliveryCad: resolved.inAppDeliveryCad,
      inAppInteractionCad: resolved.inAppInteractionCad,
      inAppConversionCad: resolved.inAppConversionCad,
      smsDeliveryCad: resolved.smsDeliveryCad,
      smsInteractionCad: resolved.smsInteractionCad,
      smsConversionCad: resolved.smsConversionCad,
      whatsappDeliveryCad: resolved.whatsappDeliveryCad,
      whatsappInteractionCad: resolved.whatsappInteractionCad,
      whatsappConversionCad: resolved.whatsappConversionCad,
      updatedAt: null as string | null,
      regionCode: resolved.regionCode,
    };
  }

  async getLegacyAdDiffusionPricingPayload(countryCode?: string | null) {
    const resolved = await this.getAdDiffusionPricing(
      await this.resolveRegionCode(countryCode),
    );
    return {
      currency: resolved.currency,
      cpmCad: resolved.cpmCad,
      cpcCad: resolved.cpcCad,
      campaignCpmCad: resolved.campaignCpmCad,
      campaignCpcCad: resolved.campaignCpcCad,
      campaignActionCad: resolved.campaignActionCad,
      conversionCad: resolved.conversionCad,
      minimumBudgetCad: resolved.minimumBudgetCad,
      updatedAt: null as string | null,
      regionCode: resolved.regionCode,
    };
  }

  async getLegacyVendorSmsPricingPayload(countryCode?: string | null) {
    const resolved = await this.getVendorSmsPricing(
      await this.resolveRegionCode(countryCode),
    );
    return {
      currency: resolved.currency,
      smsUnitCostCad: resolved.smsUnitCostCad,
      smsEnabled: resolved.smsEnabled,
      billingCyclePeriod: resolved.billingCyclePeriod,
      regionCode: resolved.regionCode,
    };
  }
}

export type {
  RegionAdDiffusionPricingPayload,
  RegionAdNotificationPricingPayload,
  RegionVendorSmsPricingPayload,
};
