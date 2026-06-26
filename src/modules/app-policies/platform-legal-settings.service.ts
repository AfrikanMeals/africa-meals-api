import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MobileAppSettingsDocument,
  MobileAppSettingsModel,
} from '@schemas/mobile-app-settings.schema';
import {
  PlatformLegalSettingsDocument,
  PlatformLegalSettingsModel,
} from '@schemas/platform-legal-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
  POLICIES_PUBLIC_CACHE_PREFIX,
} from '@common/redis-app-cache';
import { UpdatePlatformLegalSettingsDto } from './dto/update-platform-legal-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function trim(raw: string | undefined | null): string {
  return String(raw ?? '').trim();
}

function joinUrl(base: string, path: string): string {
  const b = trim(base).replace(/\/+$/, '');
  const p = trim(path).startsWith('/') ? trim(path) : `/${trim(path)}`;
  if (!b) return p;
  return `${b}${p}`;
}

function defaultLastUpdatedLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class PlatformLegalSettingsService {
  constructor(
    @InjectModel(PlatformLegalSettingsModel.name)
    private readonly _legal: Model<PlatformLegalSettingsDocument>,
    @InjectModel(MobileAppSettingsModel.name)
    private readonly _mobile: Model<MobileAppSettingsDocument>,
    @Inject(ModuleCacheLayerService)
    private readonly _cacheLayer: ModuleCacheLayerService,
  ) {}

  /** Lecture seule — pas d’upsert (évite une écriture Mongo sur chaque GET public). */
  private async readDoc(): Promise<PlatformLegalSettingsModel | null> {
    const doc = await this._legal.findOne({ key: SETTINGS_KEY }).lean().exec();
    return doc as PlatformLegalSettingsModel | null;
  }

  private async ensureDoc(): Promise<PlatformLegalSettingsModel> {
    const doc = await this._legal
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            lastUpdatedLabel: defaultLastUpdatedLabel(),
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformLegalSettingsModel;
  }

  private async mobileContact(): Promise<MobileAppSettingsModel | null> {
    const doc = await this._mobile.findOne({ key: SETTINGS_KEY }).lean().exec();
    return doc as MobileAppSettingsModel | null;
  }

  /** Variables publiques pour interpolation des politiques (FR ou EN). */
  async resolveTemplateVars(localeRaw?: string): Promise<Record<string, string>> {
    const locale = trim(localeRaw).toLowerCase() === 'en' ? 'en' : 'fr';
    const legal = (await this.readDoc()) ?? ({} as PlatformLegalSettingsModel);
    const mobile = await this.mobileContact();

    const websiteUrl = trim(legal.websiteUrl) || 'https://wise-eat.com';
    const supportEmail =
      trim(mobile?.contactEmail) ||
      trim(mobile?.mainEmail) ||
      trim(legal.supportEmail) ||
      'help@wise-eat.com';
    const privacyEmail = trim(legal.privacyEmail) || supportEmail;
    const legalEmail = trim(legal.legalEmail) || supportEmail;
    const contactPhone = trim(mobile?.contactPhone);
    const whatsappNumber = trim(mobile?.whatsappNumber);
    const lastUpdated =
      trim(legal.lastUpdatedLabel) || defaultLastUpdatedLabel();

    const privacyUrl = joinUrl(websiteUrl, legal.privacyPath || '/privacy');
    const termsUrl = joinUrl(websiteUrl, legal.termsPath || '/terms');
    const policyIndexUrl = joinUrl(
      websiteUrl,
      legal.policyIndexPath || '/policy',
    );
    const contactUrl = joinUrl(websiteUrl, legal.contactPath || '/contact');
    const statusUrl = joinUrl(websiteUrl, legal.statusPath || '/status');
    const refundPolicyUrl = joinUrl(websiteUrl, '/policy/refund');
    const shippingPolicyUrl = joinUrl(websiteUrl, '/policy/shipping');
    const vendorPolicyUrl = joinUrl(websiteUrl, '/policy/vendor');
    const courierPolicyUrl = joinUrl(websiteUrl, '/policy/courier');
    const paymentPolicyUrl = joinUrl(websiteUrl, '/policy/payment');
    const cookiesPolicyUrl = joinUrl(websiteUrl, '/policy/cookies');
    const legalNoticeUrl = joinUrl(websiteUrl, '/policy/legal-notice');

    const paymentProviders =
      locale === 'en'
        ? trim(legal.paymentProvidersEn) || 'Stripe, PayPal'
        : trim(legal.paymentProvidersFr) || 'Stripe, PayPal';
    const mapProviders =
      locale === 'en'
        ? trim(legal.mapProvidersEn) || 'Mapbox, Google Maps'
        : trim(legal.mapProvidersFr) || 'Mapbox, Google Maps';
    const governingLaw =
      locale === 'en'
        ? trim(legal.governingLawEn) || 'laws of Canada and Quebec'
        : trim(legal.governingLawFr) || 'lois du Canada et du Québec';

    let websiteHost = websiteUrl;
    try {
      websiteHost = new URL(websiteUrl).host;
    } catch {
      websiteHost = websiteUrl.replace(/^https?:\/\//i, '').split('/')[0] ?? '';
    }

    return {
      locale,
      companyLegalName: trim(legal.companyLegalName) || 'SenTech',
      tradeName: trim(legal.tradeName) || 'Wise Eat',
      websiteUrl,
      websiteHost,
      supportEmail,
      privacyEmail,
      legalEmail,
      contactPhone,
      whatsappNumber,
      registeredAddress: trim(legal.registeredAddress) || 'Canada',
      jurisdictionCountry: trim(legal.jurisdictionCountry) || 'Canada',
      governingLaw,
      minimumAge: String(legal.minimumAge ?? 16),
      accountDeletionGraceDays: String(legal.accountDeletionGraceDays ?? 30),
      paymentProviders,
      mapProviders,
      lastUpdated,
      privacyUrl,
      termsUrl,
      policyIndexUrl,
      contactUrl,
      statusUrl,
      refundPolicyUrl,
      shippingPolicyUrl,
      vendorPolicyUrl,
      courierPolicyUrl,
      paymentPolicyUrl,
      cookiesPolicyUrl,
      legalNoticeUrl,
    };
  }

  async getPublicConfig(localeRaw?: string) {
    const locale = trim(localeRaw).toLowerCase() === 'en' ? 'en' : 'fr';
    return this._cacheLayer.getOrSet(
      'publicCatalog',
      AppCacheKeys.policiesPublicConfig(locale),
      apiPublicCacheTtlMs(),
      () => this.getPublicConfigUncached(locale),
    );
  }

  private async getPublicConfigUncached(locale: string) {
    const vars = await this.resolveTemplateVars(locale);
    const legal = (await this.readDoc()) ?? ({} as PlatformLegalSettingsModel);
    const typed = legal as PlatformLegalSettingsModel & { updatedAt?: Date };
    return {
      ...vars,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getForAdmin(user: UserModel) {
    assertAdmin(user);
    const doc = await this.ensureDoc();
    const typed = doc as PlatformLegalSettingsModel & { updatedAt?: Date };
    return {
      companyLegalName: trim(doc.companyLegalName),
      tradeName: trim(doc.tradeName),
      websiteUrl: trim(doc.websiteUrl),
      supportEmail: trim(doc.supportEmail),
      privacyEmail: trim(doc.privacyEmail),
      legalEmail: trim(doc.legalEmail),
      registeredAddress: trim(doc.registeredAddress),
      jurisdictionCountry: trim(doc.jurisdictionCountry),
      governingLawFr: trim(doc.governingLawFr),
      governingLawEn: trim(doc.governingLawEn),
      minimumAge: doc.minimumAge ?? 16,
      accountDeletionGraceDays: doc.accountDeletionGraceDays ?? 30,
      paymentProvidersFr: trim(doc.paymentProvidersFr),
      paymentProvidersEn: trim(doc.paymentProvidersEn),
      mapProvidersFr: trim(doc.mapProvidersFr),
      mapProvidersEn: trim(doc.mapProvidersEn),
      lastUpdatedLabel: trim(doc.lastUpdatedLabel),
      privacyPath: trim(doc.privacyPath) || '/privacy',
      termsPath: trim(doc.termsPath) || '/terms',
      policyIndexPath: trim(doc.policyIndexPath) || '/policy',
      contactPath: trim(doc.contactPath) || '/contact',
      statusPath: trim(doc.statusPath) || '/status',
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async update(user: UserModel, dto: UpdatePlatformLegalSettingsDto) {
    assertAdmin(user);
    const updated = await this._legal
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            companyLegalName: trim(dto.companyLegalName),
            tradeName: trim(dto.tradeName),
            websiteUrl: trim(dto.websiteUrl),
            supportEmail: trim(dto.supportEmail),
            privacyEmail: trim(dto.privacyEmail),
            legalEmail: trim(dto.legalEmail),
            registeredAddress: trim(dto.registeredAddress),
            jurisdictionCountry: trim(dto.jurisdictionCountry),
            governingLawFr: trim(dto.governingLawFr),
            governingLawEn: trim(dto.governingLawEn),
            minimumAge: dto.minimumAge ?? 16,
            accountDeletionGraceDays: dto.accountDeletionGraceDays ?? 30,
            paymentProvidersFr: trim(dto.paymentProvidersFr),
            paymentProvidersEn: trim(dto.paymentProvidersEn),
            mapProvidersFr: trim(dto.mapProvidersFr),
            mapProvidersEn: trim(dto.mapProvidersEn),
            lastUpdatedLabel:
              trim(dto.lastUpdatedLabel) || defaultLastUpdatedLabel(),
            privacyPath: trim(dto.privacyPath) || '/privacy',
            termsPath: trim(dto.termsPath) || '/terms',
            policyIndexPath: trim(dto.policyIndexPath) || '/policy',
            contactPath: trim(dto.contactPath) || '/contact',
            statusPath: trim(dto.statusPath) || '/status',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    await this._cacheLayer.bustPrefixOnAllStores(POLICIES_PUBLIC_CACHE_PREFIX);
    return this.getForAdmin(user);
  }
}
