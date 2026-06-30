import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel, AddressTypeEnum } from '@schemas/address.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateAddressDto, SearchAddressDto } from './dto/addresses.dto';
import { GeocodeService } from '@modules/geocode/geocode.service';

/** Réponse enrichie pour éviter un `GET /auth/me` après chaque mutation (mobile). */
export type UserAddressesMutationResult = {
  address: Record<string, unknown> | null;
  addresses: Record<string, unknown>[];
};

@Injectable()
export class AddressesService {
  @InjectModel(AddressModel.name)
  private readonly addressModel: Model<AddressModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  constructor(private readonly geocode: GeocodeService) {}

  /** Liste des adresses du client (populate léger, sans le reste du profil). */
  async listUserAddresses(userId: string): Promise<Record<string, unknown>[]> {
    const u = await this.userModel
      .findById(userId)
      .select('addresses')
      .populate({ path: 'addresses' })
      .lean()
      .exec();
    if (!u) {
      return [];
    }
    const raw = u.addresses as Record<string, unknown>[] | undefined;
    return Array.isArray(raw) ? raw : [];
  }

  private async ensureUserOwnsAddress(user: UserModel, addressId: string) {
    const doc = await this.userModel
      .findById(user._id)
      .select('addresses')
      .lean()
      .exec();
    const ids = (doc?.addresses ?? []) as unknown[];
    if (!ids.some((aid) => aid.toString() === addressId)) {
      throw new ForbiddenException('address_not_owned');
    }
  }

  /**
   * Crée une adresse client, l’attache à l’utilisateur, retourne le document créé + liste à jour.
   * Utilisé par `POST /users/address` (corps = adresse seule) et `POST /addresses` (bundle).
   */
  async createAndAttach(
    dto: CreateAddressDto,
    authUser: UserModel,
  ): Promise<UserAddressesMutationResult> {
    const user = await this.userModel
      .findById(authUser._id)
      .select('addresses')
      .lean()
      .exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    const ids = (user.addresses ?? []) as unknown[];
    const isFirstAddress = ids.length === 0;
    const created = await this.create(
      {
        ...dto,
        isDefault: isFirstAddress,
        type: AddressTypeEnum.USER,
      },
      authUser,
    );
    if (!created) {
      throw new BadRequestException('address_not_found');
    }
    await this.userModel.updateOne(
      { _id: authUser._id },
      { $push: { addresses: created._id } },
    );
    const address = await this.addressModel.findById(created._id).lean().exec();
    const addresses = await this.listUserAddresses(authUser._id.toString());
    return {
      address: address ? (address as unknown as Record<string, unknown>) : null,
      addresses,
    };
  }

  async search(args: SearchAddressDto, user: UserModel) {
    const countryCode =
      String(args.countryCode ?? user?.appCountryCode ?? 'CA')
        .trim()
        .toUpperCase()
        .slice(0, 2) || 'CA';
    const result = await this.geocode.searchStructured(
      {
        address: args.address,
        city: args.city,
        country: args.country,
        zipCode: args.zipCode,
        countryCode,
      },
      user,
    );
    return {
      address: result.address,
      country: result.country,
      countryCode: result.countryCode,
      zipCode: result.zipCode,
      city: result.city,
      location: result.location,
    };
  }

  async create(
    {
      latitude,
      longitude,
      label,
      ...args
    }: CreateAddressDto & { type: AddressTypeEnum },
    user: UserModel,
  ) {
    const address = await this.addressModel.create({
      ...args,
      label: label?.trim() || 'Domicile',
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });

    return this.addressModel.findOne({
      _id: address._id,
    });
  }

  /**
   * Mise à jour des champs d’une adresse (ex. adresse **boutique**) — ne vérifie pas `user.addresses`.
   */
  async patchById(id: string, args: CreateAddressDto) {
    const { latitude, longitude, label, ...rest } = args;
    const patch: Record<string, unknown> = { ...rest };
    if (label !== undefined) {
      patch.label = label?.trim() || 'Domicile';
    }
    const lat =
      latitude !== undefined && latitude !== null ? Number(latitude) : NaN;
    const lon =
      longitude !== undefined && longitude !== null ? Number(longitude) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      patch.location = {
        type: 'Point',
        coordinates: [lon, lat],
      };
    }
    await this.addressModel.updateOne({ _id: id }, { $set: patch });
    return this.addressModel.findOne({ _id: id });
  }

  /** Mise à jour d’une adresse **livraison client** + bundle pour le mobile. */
  async updateUserAddress(
    id: string,
    args: CreateAddressDto,
    user: UserModel,
  ): Promise<UserAddressesMutationResult> {
    await this.ensureUserOwnsAddress(user, id);
    await this.patchById(id, args);
    const address = await this.addressModel.findById(id).lean().exec();
    const addresses = await this.listUserAddresses(user._id.toString());
    return {
      address: address ? (address as unknown as Record<string, unknown>) : null,
      addresses,
    };
  }

  /** Supprime une adresse et la retire de l’utilisateur. */
  async delete(
    id: string,
    user: UserModel,
  ): Promise<UserAddressesMutationResult> {
    const u = await this.userModel
      .findById(user._id)
      .select('addresses')
      .lean()
      .exec();
    const ids = (u?.addresses ?? []) as unknown as string[];
    if (!ids.some((aid) => aid.toString() === id)) {
      throw new ForbiddenException('address_not_owned');
    }
    await this.addressModel.deleteOne({ _id: id });
    await this.userModel.updateOne(
      { _id: user._id },
      { $pull: { addresses: id } as any },
    );
    const addresses = await this.listUserAddresses(user._id.toString());
    return { address: null, addresses };
  }

  /** Définit une adresse comme adresse par défaut (et retire le défaut des autres). */
  async setDefault(
    id: string,
    user: UserModel,
  ): Promise<UserAddressesMutationResult> {
    const u = await this.userModel
      .findById(user._id)
      .select('addresses')
      .lean()
      .exec();
    const ids = (u?.addresses ?? []) as unknown as string[];
    if (!ids.some((aid) => aid.toString() === id)) {
      throw new ForbiddenException('address_not_owned');
    }
    await this.addressModel.updateOne(
      { _id: id },
      { $set: { is_default: true } },
    );
    await this.addressModel.updateMany(
      { _id: { $in: ids, $ne: id } },
      { $set: { is_default: false } },
    );
    const address = await this.addressModel.findById(id).lean().exec();
    const addresses = await this.listUserAddresses(user._id.toString());
    return {
      address: address ? (address as unknown as Record<string, unknown>) : null,
      addresses,
    };
  }
}
