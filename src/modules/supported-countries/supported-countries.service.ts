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
}> = [
  { code: 'CA', name: 'Canada', phoneRegion: 'CA' },
  { code: 'US', name: 'États-Unis', phoneRegion: 'US' },
  { code: 'FR', name: 'France', phoneRegion: 'FR' },
  { code: 'BE', name: 'Belgique', phoneRegion: 'BE' },
  { code: 'CH', name: 'Suisse', phoneRegion: 'CH' },
  { code: 'SN', name: 'Sénégal', phoneRegion: 'SN' },
  { code: 'CI', name: "Côte d'Ivoire", phoneRegion: 'CI' },
  { code: 'CM', name: 'Cameroun', phoneRegion: 'CM' },
  { code: 'MA', name: 'Maroc', phoneRegion: 'MA' },
  { code: 'TG', name: 'Togo', phoneRegion: 'TG' },
  { code: 'BJ', name: 'Bénin', phoneRegion: 'BJ' },
  { code: 'GA', name: 'Gabon', phoneRegion: 'GA' },
  { code: 'CD', name: 'RD Congo', phoneRegion: 'CD' },
  { code: 'BF', name: 'Burkina Faso', phoneRegion: 'BF' },
  { code: 'ML', name: 'Mali', phoneRegion: 'ML' },
];

@Injectable()
export class SupportedCountriesService implements OnModuleInit {
  @InjectModel(SupportedCountryModel.name)
  private readonly _model: Model<SupportedCountryModel>;

  async onModuleInit() {
    for (const row of DEFAULT_SUPPORTED_COUNTRIES) {
      await this._model.updateOne(
        { code: row.code },
        {
          $set: {
            name: row.name,
            phoneRegion: row.phoneRegion,
            active: true,
          },
          $setOnInsert: { code: row.code },
        },
        { upsert: true },
      );
    }
  }

  async listActive(): Promise<
    Array<{ code: string; name: string; phoneRegion: string }>
  > {
    const docs = await this._model
      .find({ active: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    return docs.map((d) => ({
      code: d.code,
      name: d.name,
      phoneRegion: d.phoneRegion,
    }));
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

  /**
   * Vendeur : pays du restaurant = pays d’utilisation de l’app, tous deux dans la liste opérationnelle.
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
    if (addrCode !== appCode) {
      throw new BadRequestException(
        'L’adresse du restaurant doit être dans le même pays que celui sélectionné pour l’application.',
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
