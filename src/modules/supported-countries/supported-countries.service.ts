import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import { SupportedCountryModel } from '@schemas/supported-country.schema';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Model } from 'mongoose';
import { CreateStoreDto } from '@modules/store/dto/store.dto';
import {
  type RegionTaxBreakdown,
  type RegionTaxModule,
  type RegionTaxRule,
} from './region-tax.constants';
import {
  computeRegionTaxBreakdown,
  normalizeRegionTaxRules,
  resolveTaxCountryCode,
} from './region-tax.util';
import { normalizeCountryCode } from './client-market-region.util';
import {
  resolveStripeZeroDecimal,
  stripeAmountFactor,
} from '../../utils/stripe-currency-amount.util';

export type SupportedCountryPublicRow = {
  code: string;
  name: string;
  phoneRegion: string;
  currency: string;
  stripeZeroDecimal: boolean;
  stripeAmountFactor: number;
};

function mapSupportedCountryPublicRow(doc: {
  code?: string;
  name?: string;
  phoneRegion?: string;
  currency?: string;
  stripeZeroDecimal?: boolean | null;
}): SupportedCountryPublicRow {
  const currency = String(doc.currency ?? 'CAD').toUpperCase();
  const stripeZeroDecimal = resolveStripeZeroDecimal(
    currency,
    doc.stripeZeroDecimal,
  );
  return {
    code: String(doc.code ?? '').toUpperCase(),
    name: String(doc.name ?? ''),
    phoneRegion: String(doc.phoneRegion ?? '').toUpperCase(),
    currency,
    stripeZeroDecimal,
    stripeAmountFactor: stripeAmountFactor(currency, doc.stripeZeroDecimal),
  };
}

export const DEFAULT_SUPPORTED_COUNTRIES: Array<{
  code: string;
  name: string;
  phoneRegion: string;
  currency: string;
}> = [
  { code: 'CA', name: 'Canada', phoneRegion: 'CA', currency: 'CAD' },
  { code: 'US', name: 'États-Unis', phoneRegion: 'US', currency: 'USD' },
  { code: 'FR', name: 'France', phoneRegion: 'FR', currency: 'EUR' },
  { code: 'BE', name: 'Belgique', phoneRegion: 'BE', currency: 'EUR' },
  { code: 'CH', name: 'Suisse', phoneRegion: 'CH', currency: 'CHF' },
  { code: 'SN', name: 'Sénégal', phoneRegion: 'SN', currency: 'XOF' },
  { code: 'CI', name: "Côte d'Ivoire", phoneRegion: 'CI', currency: 'XOF' },
  { code: 'CM', name: 'Cameroun', phoneRegion: 'CM', currency: 'XAF' },
  { code: 'MA', name: 'Maroc', phoneRegion: 'MA', currency: 'MAD' },
  { code: 'TG', name: 'Togo', phoneRegion: 'TG', currency: 'XOF' },
  { code: 'BJ', name: 'Bénin', phoneRegion: 'BJ', currency: 'XOF' },
  { code: 'GA', name: 'Gabon', phoneRegion: 'GA', currency: 'XAF' },
  { code: 'CD', name: 'RD Congo', phoneRegion: 'CD', currency: 'CDF' },
  { code: 'BF', name: 'Burkina Faso', phoneRegion: 'BF', currency: 'XOF' },
  { code: 'ML', name: 'Mali', phoneRegion: 'ML', currency: 'XOF' },
];

@Injectable()
export class SupportedCountriesService implements OnModuleInit {
  private static readonly _LIST_ACTIVE_TTL_MS = 60_000;
  private _listActiveCache: {
    at: number;
    data: SupportedCountryPublicRow[];
  } | null = null;

  @InjectModel(SupportedCountryModel.name)
  private readonly _model: Model<SupportedCountryModel>;

  async onModuleInit() {
    const existingCount = await this._model.countDocuments({}).exec();
    if (existingCount > 0) {
      return;
    }
    for (const row of DEFAULT_SUPPORTED_COUNTRIES) {
      await this._model.updateOne(
        { code: row.code },
        {
          $set: {
            name: row.name,
            phoneRegion: row.phoneRegion,
            currency: row.currency,
            active: true,
          },
          $setOnInsert: { code: row.code },
        },
        { upsert: true },
      );
    }
    this._listActiveCache = null;
  }

  async listActive(): Promise<SupportedCountryPublicRow[]> {
    const now = Date.now();
    if (
      this._listActiveCache &&
      now - this._listActiveCache.at <
        SupportedCountriesService._LIST_ACTIVE_TTL_MS
    ) {
      return this._listActiveCache.data;
    }
    const docs = await this._model
      .find({ active: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    const data = docs.map((d) => mapSupportedCountryPublicRow(d));
    this._listActiveCache = { at: now, data };
    return data;
  }

  async isActiveCode(code: string): Promise<boolean> {
    const c = (code || '').toUpperCase();
    const n = await this._model
      .countDocuments({ code: c, active: true })
      .exec();
    return n > 0;
  }

  async getPhoneRegion(code: string): Promise<string | null> {
    const doc = await this._model
      .findOne({ code: (code || '').toUpperCase(), active: true })
      .lean()
      .exec();
    return doc?.phoneRegion ?? null;
  }

  async getCurrency(code: string): Promise<string | null> {
    const doc = await this._model
      .findOne({ code: (code || '').toUpperCase(), active: true })
      .lean()
      .exec();
    if (!doc?.currency) return null;
    return String(doc.currency).toUpperCase();
  }

  /** Override admin « montants entiers Stripe » pour une région (undefined = auto). */
  async getStripeZeroDecimalOverride(
    countryCode: string,
  ): Promise<boolean | undefined> {
    const c = (countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return undefined;
    const doc = await this._model.findOne({ code: c }).lean().exec();
    if (!doc || doc.stripeZeroDecimal == null) return undefined;
    return Boolean(doc.stripeZeroDecimal);
  }

  /**
   * Facteur montant affiché → unité Stripe pour un checkout (devise + région utilisateur).
   */
  async resolveStripeAmountFactorForCheckout(args: {
    currency: string;
    userCountryCode?: string | null;
  }): Promise<number> {
    const currency = String(args.currency ?? 'CAD').toUpperCase();
    const cc = String(args.userCountryCode ?? '')
      .trim()
      .toUpperCase();
    let override: boolean | undefined;
    if (/^[A-Z]{2}$/.test(cc)) {
      const doc = await this._model.findOne({ code: cc }).lean().exec();
      if (
        doc &&
        String(doc.currency ?? '').toUpperCase() === currency &&
        doc.stripeZeroDecimal != null
      ) {
        override = Boolean(doc.stripeZeroDecimal);
      }
    }
    return stripeAmountFactor(currency, override);
  }

  /** Devise plateforme (paramètres Régions) — Canada prioritaire, sinon 1ère région active. */
  async getPrimaryBillingCurrency(): Promise<string> {
    const primary = await this.getPrimaryActiveRegion();
    return primary?.currency ?? 'CAD';
  }

  /** Région active prioritaire (CA si actif, sinon première région active). */
  async getPrimaryActiveRegion(): Promise<{
    code: string;
    name: string;
    phoneRegion: string;
    currency: string;
  } | null> {
    const rows = await this.listActive();
    if (!rows.length) return null;
    return rows.find((r) => r.code === 'CA') ?? rows[0];
  }

  /**
   * Région catalogue client : query explicite → profil utilisateur → région primaire active.
   */
  async resolveClientCatalogRegion(
    user?: Pick<UserModel, 'appCountryCode'> | null,
    queryCountryCode?: string | null,
  ): Promise<string> {
    const fromQuery = normalizeCountryCode(queryCountryCode);
    if (fromQuery && (await this.isActiveCode(fromQuery))) {
      return fromQuery;
    }
    const fromUser = normalizeCountryCode(user?.appCountryCode);
    if (fromUser && (await this.isActiveCode(fromUser))) {
      return fromUser;
    }
    const primary = await this.getPrimaryActiveRegion();
    return primary?.code ?? 'CA';
  }

  /** Résumé public pour la page tarifs (devise, pays actifs, taxes région principale). */
  async getPublicRegionSettings(): Promise<{
    primaryCountryCode: string;
    primaryCountryName: string;
    currency: string;
    countries: SupportedCountryPublicRow[];
    taxes: Array<{
      name: string;
      description?: string;
      feeType: RegionTaxRule['feeType'];
      feeValue: number;
      modules: RegionTaxModule[];
    }>;
  }> {
    const countries = await this.listActive();
    const primary = (await this.getPrimaryActiveRegion()) ?? {
      code: 'CA',
      name: 'Canada',
      phoneRegion: 'CA',
      currency: 'CAD',
    };
    const taxes = await this.getTaxRulesForCountry(primary.code);
    return {
      primaryCountryCode: primary.code,
      primaryCountryName: primary.name,
      currency: primary.currency,
      countries,
      taxes: taxes.map((tax) => ({
        name: tax.name,
        description: tax.description,
        feeType: tax.feeType,
        feeValue: tax.feeValue,
        modules: tax.modules,
      })),
    };
  }

  async listAllForAdmin(): Promise<
    Array<{
      code: string;
      name: string;
      phoneRegion: string;
      currency: string;
      active: boolean;
      stripeZeroDecimal: boolean;
      stripeAmountFactor: number;
      taxes: RegionTaxRule[];
    }>
  > {
    const docs = await this._model
      .find({})
      .sort({ name: 1, code: 1 })
      .lean()
      .exec();
    return docs.map((d) => {
      const row = mapSupportedCountryPublicRow(d);
      return {
        ...row,
        active: Boolean(d.active),
        taxes: normalizeRegionTaxRules(d.taxes),
      };
    });
  }

  async getTaxRulesForCountry(code: string): Promise<RegionTaxRule[]> {
    const c = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return [];
    const doc = await this._model.findOne({ code: c, active: true }).lean().exec();
    if (!doc) return [];
    return normalizeRegionTaxRules(doc.taxes);
  }

  async getTaxRulesForCountryAdmin(code: string): Promise<RegionTaxRule[]> {
    const c = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return [];
    const doc = await this._model.findOne({ code: c }).lean().exec();
    if (!doc) return [];
    return normalizeRegionTaxRules(doc.taxes);
  }

  async saveTaxRulesForCountry(
    code: string,
    taxes: RegionTaxRule[],
  ): Promise<RegionTaxRule[]> {
    const c = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) {
      throw new BadRequestException('invalid_country_code');
    }
    const normalized = normalizeRegionTaxRules(taxes);
    const doc = await this._model.findOne({ code: c }).exec();
    if (!doc) {
      throw new BadRequestException('country_not_found');
    }
    doc.taxes = normalized as SupportedCountryModel['taxes'];
    await doc.save();
    this._listActiveCache = null;
    return normalized;
  }

  /**
   * Taxes pour un module : 0 % si le pays n’est pas actif dans les régions.
   */
  async computeTaxesForModule(args: {
    countryCode: string;
    baseAmount: number;
    module: RegionTaxModule;
  }): Promise<RegionTaxBreakdown> {
    const countryCode = resolveTaxCountryCode([args.countryCode]);
    const baseAmount = Math.max(0, Number(args.baseAmount) || 0);
    if (!countryCode) {
      return {
        countryCode: '',
        module: args.module,
        baseAmount,
        lines: [],
        taxTotal: 0,
      };
    }
    const rules = await this.getTaxRulesForCountry(countryCode);
    if (!rules.length) {
      return {
        countryCode,
        module: args.module,
        baseAmount,
        lines: [],
        taxTotal: 0,
      };
    }
    return computeRegionTaxBreakdown({
      countryCode,
      baseAmount,
      module: args.module,
      rules,
    });
  }

  resolveUserTaxCountryCode(
    user: UserModel,
    deliveryCountryCode?: string | null,
  ): string {
    return resolveTaxCountryCode([
      deliveryCountryCode,
      (user as UserModel & { appCountryCode?: string }).appCountryCode,
    ]);
  }

  async saveAllForAdmin(
    countries: Array<{
      code: string;
      name: string;
      phoneRegion: string;
      currency: string;
      active: boolean;
      stripeZeroDecimal?: boolean;
    }>,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const row of countries) {
      const code = String(row.code ?? '')
        .trim()
        .toUpperCase();
      const name = String(row.name ?? '').trim();
      const phoneRegion = String(row.phoneRegion ?? '')
        .trim()
        .toUpperCase();
      const currency = String(row.currency ?? '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) {
        throw new BadRequestException(
          `invalid_country_code:${code || 'empty'}`,
        );
      }
      if (!/^[A-Z]{2}$/.test(phoneRegion)) {
        throw new BadRequestException(`invalid_phone_region:${code}`);
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new BadRequestException(`invalid_currency:${code}`);
      }
      if (!name) {
        throw new BadRequestException(`country_name_required:${code}`);
      }
      if (seen.has(code)) {
        throw new BadRequestException(`duplicate_country_code:${code}`);
      }
      seen.add(code);
      const $set: Record<string, unknown> = {
        name,
        phoneRegion,
        currency,
        active: Boolean(row.active),
      };
      if (row.stripeZeroDecimal != null) {
        $set.stripeZeroDecimal = Boolean(row.stripeZeroDecimal);
      }
      await this._model.updateOne(
        { code },
        {
          $set,
          $setOnInsert: { code, taxes: [] },
        },
        { upsert: true },
      );
    }
    this._listActiveCache = null;
  }

  /**
   * Vendeur : pays du restaurant dans la liste opérationnelle ; téléphone valide pour ce pays.
   * Le pays d’utilisation du profil doit rester dans la liste active (réglages utilisateur).
   */
  async assertVendorApplicationCompatible(
    user: UserModel,
    dto: CreateStoreDto,
  ): Promise<void> {
    const activeCodes = new Set(
      (await this.listActive()).map((x) => x.code.toUpperCase()),
    );
    const addrCode = (
      dto.region ||
      dto.address?.countryCode ||
      ''
    ).toUpperCase();
    if (!addrCode) {
      throw new BadRequestException('address_country_required');
    }
    if (!activeCodes.has(addrCode)) {
      throw new BadRequestException(
        'Ce pays n’est pas encore pris en charge pour les vendeurs.',
      );
    }
    const appCode = (
      (user as UserModel & { appCountryCode?: string }).appCountryCode || 'CA'
    ).toUpperCase();
    if (!activeCodes.has(appCode)) {
      throw new BadRequestException(
        'Choisissez un pays d’utilisation valide dans votre profil.',
      );
    }
    const region = await this.getPhoneRegion(addrCode);
    if (!region) {
      throw new BadRequestException('Configuration pays incomplète.');
    }
    const parsed = parsePhoneNumberFromString(
      dto.phoneNumber,
      region as import('libphonenumber-js').CountryCode,
    );
    if (!parsed?.isValid()) {
      throw new BadRequestException(
        'Numéro de téléphone invalide pour le pays du restaurant.',
      );
    }
  }
}
