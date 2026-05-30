import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import { SupportedCountryModel } from '@schemas/supported-country.schema';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Model } from 'mongoose';
import { CreateStoreDto } from '@modules/store/dto/store.dto';

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
  private _listActiveCache:
    | {
        at: number;
        data: Array<{
          code: string;
          name: string;
          phoneRegion: string;
          currency: string;
        }>;
      }
    | null = null;

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

  async listActive(): Promise<
    Array<{ code: string; name: string; phoneRegion: string; currency: string }>
  > {
    const now = Date.now();
    if (
      this._listActiveCache &&
      now - this._listActiveCache.at < SupportedCountriesService._LIST_ACTIVE_TTL_MS
    ) {
      return this._listActiveCache.data;
    }
    const docs = await this._model
      .find({ active: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    const data = docs.map((d) => ({
      code: d.code,
      name: d.name,
      phoneRegion: d.phoneRegion,
      currency: String(d.currency ?? 'CAD').toUpperCase(),
    }));
    this._listActiveCache = { at: now, data };
    return data;
  }

  async isActiveCode(code: string): Promise<boolean> {
    const c = (code || '').toUpperCase();
    const n = await this._model.countDocuments({ code: c, active: true }).exec();
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

  async listAllForAdmin(): Promise<
    Array<{
      code: string;
      name: string;
      phoneRegion: string;
      currency: string;
      active: boolean;
    }>
  > {
    const docs = await this._model
      .find({})
      .sort({ name: 1, code: 1 })
      .lean()
      .exec();
    return docs.map((d) => ({
      code: String(d.code ?? '').toUpperCase(),
      name: String(d.name ?? ''),
      phoneRegion: String(d.phoneRegion ?? '').toUpperCase(),
      currency: String(d.currency ?? 'CAD').toUpperCase(),
      active: Boolean(d.active),
    }));
  }

  async saveAllForAdmin(
    countries: Array<{
      code: string;
      name: string;
      phoneRegion: string;
      currency: string;
      active: boolean;
    }>,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const row of countries) {
      const code = String(row.code ?? '').trim().toUpperCase();
      const name = String(row.name ?? '').trim();
      const phoneRegion = String(row.phoneRegion ?? '').trim().toUpperCase();
      const currency = String(row.currency ?? '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) {
        throw new BadRequestException(`invalid_country_code:${code || 'empty'}`);
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
      await this._model.updateOne(
        { code },
        {
          $set: {
            name,
            phoneRegion,
            currency,
            active: Boolean(row.active),
          },
          $setOnInsert: { code },
        },
        { upsert: true },
      );
    }
    const keepCodes = [...seen.values()];
    await this._model.deleteMany({
      code: { $nin: keepCodes },
    });
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
    const addrCode = (dto.address?.countryCode || '').toUpperCase();
    if (!addrCode) {
      throw new BadRequestException('address_country_required');
    }
    if (!activeCodes.has(addrCode)) {
      throw new BadRequestException(
        'Ce pays n’est pas encore pris en charge pour les vendeurs.',
      );
    }
    const appCode = ((user as UserModel & { appCountryCode?: string })
      .appCountryCode || 'CA'
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
