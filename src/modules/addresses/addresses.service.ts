import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel, AddressTypeEnum } from '@schemas/address.schema';
import { UserModel } from '@schemas/user.schema';
import axios from 'axios';
import { Model } from 'mongoose';
import { CreateAddressDto, SearchAddressDto } from './dto/addresses.dto';

@Injectable()
export class AddressesService {
  @InjectModel(AddressModel.name)
  private readonly addressModel: Model<AddressModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  async search(args: SearchAddressDto, user: UserModel) {
    const q = encodeURIComponent(
      `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
    );
    const url = `${this._configService.get<string>(
      'MAP_BOX_API_URL',
    )}?q=${q}&proximity=ip&types=address&access_token=${this._configService.get<string>(
      'MAPBOX_ACCESS_TOKEN',
    )}&limit=1&autocomplete=true&language=fr`;
    // console.log('🚀 ~ AddressesService ~ create ~ url:', url);
    const { data } = await axios.get(url);

    if (!data?.features?.length) {
      throw new NotFoundException('address_not_found');
    }

    const formatPostalcode = (code: string) =>
      code?.split('')?.join('')?.toLowerCase()?.trim();

    const item =
      (data?.features || []).find(
        (add) =>
          formatPostalcode(add?.properties?.context?.postcode?.name) ===
          formatPostalcode(args.zipCode),
      ) ?? data?.features[0];
    // console.log('🚀 ~ AddressesService ~ search ~ item:', JSON.stringify(item));

    if (
      formatPostalcode(item?.properties?.context?.postcode?.name) !==
      formatPostalcode(args.zipCode)
    ) {
      throw new NotFoundException('invalid_zip_code');
    }

    return {
      address:
        item.properties.full_address ??
        item.name ??
        `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
      country: args.country,
      countryCode: item.properties.context?.country?.country_code,
      zipCode: args.zipCode,
      city: args.city,
      location: item.geometry.coordinates ?? [0, 0], // [Longitude, Latitude]
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

  async update(id: string, args: CreateAddressDto, user: UserModel) {
    const { latitude, longitude, label, ...rest } = args;
    await this.addressModel.updateOne(
      { _id: id },
      {
        ...rest,
        ...(label !== undefined && {
          label: label?.trim() || 'Domicile',
        }),
        location: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
      },
    );
    return this.addressModel.findOne({ _id: id });
  }

  /** Supprime une adresse et la retire de l’utilisateur. */
  async delete(id: string, user: UserModel) {
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
  }

  /** Définit une adresse comme adresse par défaut (et retire le défaut des autres). */
  async setDefault(id: string, user: UserModel) {
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
    return this.addressModel.findOne({ _id: id });
  }
}
